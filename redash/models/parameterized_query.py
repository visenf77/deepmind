import re
from functools import partial
from numbers import Number
import os

import pystache
from dateutil.parser import parse
from funcy import distinct

# from redash.utils import mustache_render


def _pluck_name_and_value(default_column, row):
    row = {k.lower(): v for k, v in row.items()}
    name_column = "name" if "name" in row.keys() else default_column.lower()
    value_column = "value" if "value" in row.keys() else default_column.lower()
    return {"name": row[name_column], "value": str(row[value_column])}


def _load_result(query_id, org):
    """
    Load the latest saved QueryResult for query_id.
    """
    from redash import models

    query = models.Query.get_by_id_and_org(query_id, org)
    if query.data_source:
        query_result = models.QueryResult.get_by_id_and_org(query.latest_query_data_id, org)
        return query_result.data
    else:
        raise QueryDetachedFromDataSourceError(query_id)



def mustache_render(template, context):
    """
    Very simple mustache-like template renderer (no chevron dependency).
    Supports {{variable}} replacement only.
    """
    try:
        if not isinstance(template, str):
            template = str(template)

        # Load template file if it exists
        search_dirs = ["/app/redash/models", os.getcwd()]
        for d in search_dirs:
            file_path = os.path.join(d, template)
            if os.path.exists(file_path):
                with open(file_path, "r") as f:
                    template = f.read()
                break

        # Replace {{key}} with values
        def replacer(match):
            key = match.group(1).strip()
            return str(context.get(key, f"{{{{{key}}}}}"))

        rendered = re.sub(r"{{\s*(.*?)\s*}}", replacer, template)
        return rendered.strip()

    except Exception as e:
        return str(template)


def _execute_query_and_get_result(query_id, org, parameters=None):
    """
    Execute a query by its ID, render parameters with Mustache, and return parsed data.
    Falls back to stored results if anything fails.
    """
    import json
    from redash import models

    try:
        query = models.Query.get_by_id_and_org(query_id, org)
        if not query or not query.data_source:
            raise Exception("Query or data source not found")

        # Step 1️⃣ - Render with Mustache
        try:
            rendered_query = mustache_render(query.query_text, parameters or {})
        except Exception as e:
            rendered_query = str(query.query_text)

        # Step 2️⃣ - Execute using the Query Runner
        runner = query.data_source.query_runner

        # Ensure rendered_query is a string
        if not isinstance(rendered_query, str):
            rendered_query = str(rendered_query)

        data_json, error = runner.run_query(rendered_query, None)

        if error:
            raise Exception(error)

        # Step 3️⃣ - Parse JSON result
        try:
            if isinstance(data_json, str):
                data = json.loads(data_json)
            else:
                # Already a dict
                data = data_json

            if "columns" in data and "rows" in data:
                return data
            else:
                raise Exception("Invalid data structure")
        except Exception as parse_error:
            raise

    except Exception as e:
        pass

    # Step 4️⃣ - Fallback to stored result
    return _load_result(query_id, org)




def dropdown_values(query_id, org, parameters=None):
    """
    Returns a list of {"name": <name>, "value": <value>} for the given query_id.

    If `parameters` is provided, the child query will be executed with those parameters
    to produce a parameterized dropdown (used by dependent_filter). `parameters` is a dict
    mapping parameter names to values.
    """
    data = _execute_query_and_get_result(query_id, org, parameters=parameters)
    first_column = data["columns"][0]["name"]
    pluck = partial(_pluck_name_and_value, first_column)
    return list(map(pluck, data["rows"]))


def join_parameter_list_values(parameters, schema):
    updated_parameters = {}
    for key, value in parameters.items():
        if isinstance(value, list):
            definition = next((definition for definition in schema if definition["name"] == key), {})
            multi_values_options = definition.get("multiValuesOptions", {})
            separator = str(multi_values_options.get("separator", ","))
            prefix = str(multi_values_options.get("prefix", ""))
            suffix = str(multi_values_options.get("suffix", ""))
            updated_parameters[key] = separator.join([prefix + v + suffix for v in value])
        else:
            updated_parameters[key] = value
    return updated_parameters


def _collect_key_names(nodes):
    keys = []
    for node in nodes._parse_tree:
        if isinstance(node, pystache.parser._EscapeNode):
            keys.append(node.key)
        elif isinstance(node, pystache.parser._SectionNode):
            keys.append(node.key)
            keys.extend(_collect_key_names(node.parsed))
    return distinct(keys)


def _collect_query_parameters(query):
    nodes = pystache.parse(query)
    keys = _collect_key_names(nodes)
    return keys


def _parameter_names(parameter_values):
    names = []
    for key, value in parameter_values.items():
        if isinstance(value, dict):
            for inner_key in value.keys():
                names.append("{}.{}".format(key, inner_key))
        else:
            names.append(key)
    return names


def _is_number(string):
    try:
        if isinstance(string, Number):
            return True
        float(string)
        return True
    except Exception:
        return False


def _is_regex_pattern(value, regex):
    try:
        if regex is None:
            return False
        if re.compile(regex).fullmatch(value):
            return True
        else:
            return False
    except re.error:
        return False


def _is_date(string):
    try:
        parse(string)
        return True
    except Exception:
        return False


def _is_date_range(obj):
    try:
        return isinstance(obj, dict) and _is_date(obj["start"]) and _is_date(obj["end"])
    except Exception:
        return False


def _is_value_within_options(value, dropdown_options, allow_list=False):
    if dropdown_options is None:
        return False
    if isinstance(value, list):
        return allow_list and set(map(str, value)).issubset(set(dropdown_options))
    return str(value) in dropdown_options


def _get_parent_name_from_definition(definition):
    """
    Normalize possible parent keys to a canonical parent name string or None.
    Accepts 'parent', 'parentParameter', 'parent_parameter'.
    """
    return (
        definition.get("parent")
        or definition.get("parentParameter")
        or definition.get("parent_parameter")
    )


class ParameterizedQuery:
    def __init__(self, template, schema=None, org=None):
        self.schema = schema or []
        self.org = org
        self.template = template
        self.query = template
        self.parameters = {}

    def apply(self, parameters):
        invalid_parameter_names = [key for (key, value) in parameters.items() if not self._valid(key, value, parameters)]
        if invalid_parameter_names:
            raise InvalidParameterError(invalid_parameter_names)
        else:
            self.parameters.update(parameters)
            
            self.query = mustache_render(self.template, join_parameter_list_values(parameters, self.schema))
        return self

    def _valid(self, name, value, parameters):
        if not self.schema:
            return True

        definition = next(
            (definition for definition in self.schema if definition["name"] == name),
            None,
        )

        if not definition:
            return False

        enum_options = definition.get("enumOptions")
        query_id = definition.get("queryId")
        regex = definition.get("regex")
        allow_multiple_values = isinstance(definition.get("multiValuesOptions"), dict)
        parent_name = _get_parent_name_from_definition(definition)

        if isinstance(enum_options, str):
            enum_options = enum_options.split("\n")

        def _query_validator(v):
            exec_params = None
            # Try using parent_parameter in definition (not parameters), which is a list of dicts
            parent_param_list = definition.get("parent_parameter")
            if isinstance(parent_param_list, list):
                # E.g. [{'name': 'location', 'value': 'Civil Lines Zone'}, ...]
                exec_params = {p["name"]: p.get("value") for p in parent_param_list if "name" in p}
            elif parent_name:
                # Fallback for older logic / single parent key
                if parent_name in parameters:
                    exec_params = {parent_name: parameters[parent_name]}
            options = [row["value"] for row in dropdown_values(query_id, self.org, parameters=exec_params)]
            return _is_value_within_options(v, options, allow_multiple_values)

        validators = {
            "text": lambda value: isinstance(value, str),
            "text-pattern": lambda value: _is_regex_pattern(value, regex),
            "number": _is_number,
            "enum": lambda value: _is_value_within_options(value, enum_options, allow_multiple_values),
            "query": lambda value: _is_value_within_options(
                value,
                [v["value"] for v in dropdown_values(query_id, self.org)],
                allow_multiple_values,
            ),
            # Skip validation for dependent-filters: always returns True
            "dependent-filters": lambda value: True,
            "date": _is_date,
            "datetime-local": _is_date,
            "datetime-with-seconds": _is_date,
            "date-range": _is_date_range,
            "datetime-range": _is_date_range,
            "datetime-range-with-seconds": _is_date_range,
        }

        validate = validators.get(definition["type"], lambda x: False)

        try:
            return validate(value)
        except QueryDetachedFromDataSourceError:
            raise
        except Exception:
            return False

    @property
    def is_safe(self):
        text_parameters = [param for param in self.schema if param["type"] == "text"]
        return not any(text_parameters)

    @property
    def missing_params(self):
        query_parameters = set(_collect_query_parameters(self.template))
        return set(query_parameters) - set(_parameter_names(self.parameters))

    @property
    def text(self):
        return self.query


class InvalidParameterError(Exception):
    def __init__(self, parameters):
        parameter_names = ", ".join(parameters)
        message = "The following parameter values are incompatible with their definitions: {}".format(parameter_names)
        super(InvalidParameterError, self).__init__(message)


class QueryDetachedFromDataSourceError(Exception):
    def __init__(self, query_id):
        self.query_id = query_id
        super(QueryDetachedFromDataSourceError, self).__init__(
            "This query is detached from any data source. Please select a different query."
        )
