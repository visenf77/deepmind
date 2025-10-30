/* eslint-disable no-console */
import { isNull, isUndefined, isArray, isEmpty, get, has, map, join } from "lodash";
import { Query } from "@/services/query";
import Parameter from "./Parameter";

class DependentBasedDropdownParameter extends Parameter {
  constructor(parameter, parentQueryId, parent_parameter, parent_parameter_value) {
    super(parameter, parentQueryId);

    this.queryId = parameter.queryId;
    this.multiValuesOptions = parameter.multiValuesOptions || null;

    // parent_parameter: now always an array of objects: [{name,value}, ...]
    // Accept as argument, else from parameter. Normalize to [] if null.
    this.parent_parameter =
      parent_parameter ||
      parameter.parent_parameter ||
      [];
    // parent_parameter_value: optional, legacy; ignore and use from parent_parameter array.
    // this.parent_parameter_value = parent_parameter_value || parameter.parent_parameter_value || null;

    // initialize value using internal normalization
    this.setValue(parameter.value);
  }

  // Normalize incoming value for UI / storage
  normalizeValue(value) {
    if (isUndefined(value) || isNull(value) || (isArray(value) && isEmpty(value))) {
      return null;
    }

    if (this.multiValuesOptions) {
      return isArray(value) ? value : [value];
    }

    return isArray(value) ? value[0] : value;
  }

  // Prepare execution value (string or joined list) to send to queries
  getExecutionValue(extra = {}) {
    const { joinListValues } = extra;
    if (joinListValues && isArray(this.value)) {
      const separator = get(this.multiValuesOptions, "separator", ",");
      const prefix = get(this.multiValuesOptions, "prefix", "");
      const suffix = get(this.multiValuesOptions, "suffix", "");
      const parameterValues = map(this.value, (v) => `${prefix}${v}${suffix}`);
      return join(parameterValues, separator);
    }
    return this.value;
  }

  // URL serialization
  toUrlParams() {
    const prefix = this.urlPrefix;
    let urlParam = this.value;
    if (this.multiValuesOptions && isArray(this.value)) {
      try {
        urlParam = JSON.stringify(this.value);
      } catch (e) {
        urlParam = this.value;
      }
    }

    return {
      [`${prefix}${this.name}`]: !this.isEmpty ? urlParam : null,
    };
  }

  // Load value from URL params
  fromUrlParams(query) {
    const prefix = this.urlPrefix;
    const key = `${prefix}${this.name}`;
    if (has(query, key)) {
      if (this.multiValuesOptions) {
        try {
          const valueFromJson = JSON.parse(query[key]);
          this.setValue(isArray(valueFromJson) ? valueFromJson : query[key]);
        } catch (e) {
          this.setValue(query[key]);
        }
      } else {
        this.setValue(query[key]);
      }
    }
  }

  // Build parameters object for executing the child dropdown query using parent values
  _buildChildQueryParams() {
    if (!this.parent_parameter || !isArray(this.parent_parameter) || this.parent_parameter.length === 0) {
      return null;
    }

    // parent_parameter: [{name,value}, ...] --> build { name1: value1, name2: value2 }
    const paramsObj = {};
    for (const parent of this.parent_parameter) {
      if (parent && typeof parent === "object" && "name" in parent) {
        paramsObj[parent.name] = parent.value;
      }
    }
    return Object.keys(paramsObj).length === 0 ? null : paramsObj;
  }

  // Execute child query to obtain dropdown options; returns Promise<[{name, value}]>
  loadDropdownValues() {
    const params = this._buildChildQueryParams();
    console.log({ params }, this.parameter, this.parentQueryId, this.queryId);

    if (this.parentQueryId) {
      return Query.dependentAssociatedDropdown({
        queryId: this.parentQueryId,
        dropdownQueryId: this.queryId,
        parameters: params,
      }).catch(() => Promise.resolve([]));
    }

    return Query.dependentAsDropdown({ id: this.queryId ,parameters: params,}).catch(() => Promise.resolve([]));
  }

  // Called when parent changes: reload options and optionally update value via onUpdate callback
  onParentChange(onUpdate) {
    return this.loadDropdownValues()
      .then((options) => {
        if (typeof onUpdate === "function") {
          onUpdate(options);
        }
        return options;
      })
      .catch(() => {
        if (typeof onUpdate === "function") {
          onUpdate([]);
        }
        return [];
      });
  }

  // Keep locals in sync and allow hooking before saving
  setValue(value) {
    super.setValue(value);
    // update any behavior tied to locals (already handled in super)
    return this;
  }

  // Saveable representation includes queryId, multiValuesOptions and parent reference
  toSaveableObject() {
    const base = super.toSaveableObject();
    return Object.assign({}, base, {
      queryId: this.queryId,
      multiValuesOptions: this.multiValuesOptions,
      parent_parameter: this.parent_parameter, // now an array of {name,value}
    });
  }
}

export default DependentBasedDropdownParameter;
