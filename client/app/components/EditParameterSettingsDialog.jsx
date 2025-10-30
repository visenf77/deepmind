/* eslint-disable no-console */
import { includes, words, capitalize, clone, isNull, isArray } from "lodash";
import React, { useState, useEffect } from "react";
import PropTypes from "prop-types";
import Checkbox from "antd/lib/checkbox";
import Modal from "antd/lib/modal";
import Form from "antd/lib/form";
import Button from "antd/lib/button";
import Select from "antd/lib/select";
import Input from "antd/lib/input";
import Divider from "antd/lib/divider";
import { wrap as wrapDialog, DialogPropType } from "@/components/DialogWrapper";
import QuerySelector from "@/components/QuerySelector";
import { Query } from "@/services/query";
import { useUniqueId } from "@/lib/hooks/useUniqueId";
import "./EditParameterSettingsDialog.less";

const { Option } = Select;
const formItemProps = { labelCol: { span: 6 }, wrapperCol: { span: 16 } };

function getDefaultTitle(text) {
  return capitalize(words(text).join(" ")); // humanize
}

function isTypeDateRange(type) {
  return /-range/.test(type);
}

function joinExampleList(multiValuesOptions) {
  const { prefix, suffix } = multiValuesOptions;
  return ["value1", "value2", "value3"].map((value) => `${prefix}${value}${suffix}`).join(",");
}

function NameInput({ name, type, onChange, existingNames, setValidation }) {
  let helpText = "";
  let validateStatus = "";

  if (!name) {
    helpText = "Choose a keyword for this parameter";
    setValidation(false);
  } else if (includes(existingNames, name)) {
    helpText = "Parameter with this name already exists";
    setValidation(false);
    validateStatus = "error";
  } else {
    if (isTypeDateRange(type)) {
      helpText = (
        <React.Fragment>
          Appears in query as{" "}
          <code style={{ display: "inline-block", color: "inherit" }}>{`{{${name}.start}} {{${name}.end}}`}</code>
        </React.Fragment>
      );
    }
    setValidation(true);
  }

  return (
    <Form.Item required label="Keyword" help={helpText} validateStatus={validateStatus} {...formItemProps}>
      <Input onChange={(e) => onChange(e.target.value)} autoFocus />
    </Form.Item>
  );
}

NameInput.propTypes = {
  name: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  existingNames: PropTypes.arrayOf(PropTypes.string).isRequired,
  setValidation: PropTypes.func.isRequired,
  type: PropTypes.string.isRequired,
};

function EditParameterSettingsDialog(props) {
  const [param, setParam] = useState(clone(props.parameter));
  const [isNameValid, setIsNameValid] = useState(true);
  const [initialQuery, setInitialQuery] = useState();
  const [userInput, setUserInput] = useState(param.regex || "");
  const [isValidRegex, setIsValidRegex] = useState(true);

  const isNew = !props.parameter.name;

  // fetch query by id
  useEffect(() => {
    const queryId = props.parameter.queryId;
    if (queryId) {
      Query.get({ id: queryId }).then(setInitialQuery);
    }
  }, [props.parameter.queryId]);

  function isFulfilled() {
    // name
    if (!isNameValid) {
      return false;
    }

    // title
    if (param.title === "") {
      return false;
    }

    // query
    if (param.type === "query" && !param.queryId) {
      return false;
    }

    // dependent-filters: must select parent_parameter
    // parent_parameter must be a non-empty array if present
    if (
      param.type === "dependent-filters" &&
      (!param.parent_parameter ||
        !Array.isArray(param.parent_parameter) ||
        param.parent_parameter.length === 0) &&
      !param.queryId
    ) {
      return false;
    }

    return true;
  }

  function onConfirm() {
    // update title to default
    if (!param.title) {
      // forced to do this cause param won't update in time for save
      param.title = getDefaultTitle(param.name);
      setParam(param);
    }

    props.dialog.close(param);
  }

  const paramFormId = useUniqueId("paramForm");

  const handleRegexChange = (e) => {
    setUserInput(e.target.value);
    try {
      new RegExp(e.target.value);
      setParam({ ...param, regex: e.target.value });
      setIsValidRegex(true);
    } catch (error) {
      setIsValidRegex(false);
    }
  };

  // For dependent-filters: Build list of available parameter names to select as parent
  // Exclude current parameter (if named and not new)
  const availableParentParameters =
    props.parameters && Array.isArray(props.parameters)
      ? props.parameters
          .filter(
            (p) => p.name && (!param.name || p.name !== param.name) // exclude self
          )
          .map((p) => p.name)
      : [];

  // Helper: get default value for a parameter to be used for parent_parameter_value
  function getParameterDefaultValueByName(paramName) {
    if (!paramName || !props.parameters || !Array.isArray(props.parameters)) return undefined;
    const foundParam = props.parameters.find((p) => p.name === paramName);
    // Try to get the .value field, fallback to undefined if not present
    return foundParam ? foundParam.value : undefined;
  }

  // Helper: for dependent-filters value, get parent_parameter as [{ name, value }]
  // Value in the Select will be name array,
  // but in param.parent_parameter we store [{name,value}, ...]
  // Accepts possible legacy string/array or [{name,value}]
  function getSelectedParentNames(parent_parameter) {
    if (!parent_parameter) return [];
    if (typeof parent_parameter === "string") return [parent_parameter];
    if (Array.isArray(parent_parameter)) {
      // Case where parent_parameter: [string] or [{ name, value }]
      if (parent_parameter.length === 0) return [];
      if (typeof parent_parameter[0] === "string") return parent_parameter;
      if (typeof parent_parameter[0] === "object" && parent_parameter[0].name) {
        return parent_parameter.map((o) => o.name);
      }
    }
    return [];
  }

  return (
    <Modal
      {...props.dialog.props}
      title={isNew ? "Add Parameter" : param.name}
      width={600}
      footer={[
        <Button key="cancel" onClick={props.dialog.dismiss}>
          Cancel
        </Button>,
        <Button
          key="submit"
          htmlType="submit"
          disabled={!isFulfilled()}
          type="primary"
          form={paramFormId}
          data-test="SaveParameterSettings">
          {isNew ? "Add Parameter" : "OK"}
        </Button>,
      ]}>
      <Form layout="horizontal" onFinish={onConfirm} id={paramFormId}>
        {isNew && (
          <NameInput
            name={param.name}
            onChange={(name) => setParam({ ...param, name })}
            setValidation={setIsNameValid}
            existingNames={props.existingParams}
            type={param.type}
          />
        )}
        <Form.Item required label="Title" {...formItemProps}>
          <Input
            value={isNull(param.title) ? getDefaultTitle(param.name) : param.title}
            onChange={(e) => setParam({ ...param, title: e.target.value })}
            data-test="ParameterTitleInput"
          />
        </Form.Item>
        <Form.Item label="Type" {...formItemProps}>
          <Select value={param.type} onChange={(type) => setParam({ ...param, type })} data-test="ParameterTypeSelect">
            <Option value="text" data-test="TextParameterTypeOption">
              Text
            </Option>
            <Option value="text-pattern">Text Pattern</Option>
            <Option value="number" data-test="NumberParameterTypeOption">
              Number
            </Option>
            <Option value="enum">Dropdown List</Option>
            <Option value="query">Query Based Dropdown List</Option>
            <Option value="dependent-filters">Filters dependent Based Dropdown List</Option>
            <Option disabled key="dv1">
              <Divider className="select-option-divider" />
            </Option>
            <Option value="date" data-test="DateParameterTypeOption">
              Date
            </Option>
            <Option value="datetime-local" data-test="DateTimeParameterTypeOption">
              Date and Time
            </Option>
            <Option value="datetime-with-seconds">Date and Time (with seconds)</Option>
            <Option disabled key="dv2">
              <Divider className="select-option-divider" />
            </Option>
            <Option value="date-range" data-test="DateRangeParameterTypeOption">
              Date Range
            </Option>
            <Option value="datetime-range">Date and Time Range</Option>
            <Option value="datetime-range-with-seconds">Date and Time Range (with seconds)</Option>
          </Select>
        </Form.Item>
        {param.type === "text-pattern" && (
          <Form.Item
            label="Regex"
            help={!isValidRegex ? "Invalid Regex Pattern" : "Valid Regex Pattern"}
            {...formItemProps}>
            <Input
              value={userInput}
              onChange={handleRegexChange}
              className={!isValidRegex ? "input-error" : ""}
              data-test="RegexPatternInput"
            />
          </Form.Item>
        )}
        {param.type === "enum" && (
          <Form.Item label="Values" help="Dropdown list values (newline delimited)" {...formItemProps}>
            <Input.TextArea
              rows={3}
              value={param.enumOptions}
              onChange={(e) => setParam({ ...param, enumOptions: e.target.value })}
            />
          </Form.Item>
        )}
        {(param.type === "query" || param.type === "dependent-filters") && (
          <Form.Item label="Query" help="Select query to load dropdown values from" {...formItemProps}>
            <QuerySelector
              selectedQuery={initialQuery}
              onChange={(q) => setParam({ ...param, queryId: q && q.id })}
              type="select"
            />
          </Form.Item>
        )}
        {param.type === "dependent-filters" && (
          <Form.Item
            label="Parent Parameter"
            help="Select parameter(s) on which this one should depend"
            {...formItemProps}>
            <Select
              mode="multiple"
              value={getSelectedParentNames(param.parent_parameter)}
              onChange={(selectedNames) => {
                // For each selected name, lookup value
                const paramObjs = selectedNames.map((parentName) => ({
                  name: parentName,
                  value: getParameterDefaultValueByName(parentName),
                }));
                console.log({selectedNames, paramObjs});
                setParam({
                  ...param,
                  parent_parameter: paramObjs,
                  // Optional: Keep a flat array of parent values for backwards compat if needed
                  parent_parameter_value: paramObjs.map(obj => obj.value),
                });
              }}
              placeholder="Choose parent parameter(s)"
              data-test="ParentParameterSelect">
              {availableParentParameters.map((name) => (
                <Option key={name} value={name}>
                  {name}
                </Option>
              ))}
            </Select>
          </Form.Item>
        )}
        {(param.type === "enum" || param.type === "query") && (
          <Form.Item className="m-b-0" label=" " colon={false} {...formItemProps}>
            <Checkbox
              defaultChecked={!!param.multiValuesOptions}
              onChange={(e) =>
                setParam({
                  ...param,
                  multiValuesOptions: e.target.checked
                    ? {
                        prefix: "",
                        suffix: "",
                        separator: ",",
                      }
                    : null,
                })
              }
              data-test="AllowMultipleValuesCheckbox">
              Allow multiple values
            </Checkbox>
          </Form.Item>
        )}
        {(param.type === "enum" || param.type === "query") && param.multiValuesOptions && (
          <Form.Item
            label="Quotation"
            help={
              <React.Fragment>
                Placed in query as: <code>{joinExampleList(param.multiValuesOptions)}</code>
              </React.Fragment>
            }
            {...formItemProps}>
            <Select
              value={param.multiValuesOptions.prefix}
              onChange={(quoteOption) =>
                setParam({
                  ...param,
                  multiValuesOptions: {
                    ...param.multiValuesOptions,
                    prefix: quoteOption,
                    suffix: quoteOption,
                  },
                })
              }
              data-test="QuotationSelect">
              <Option value="">None (default)</Option>
              <Option value="'">Single Quotation Mark</Option>
              <Option value={'"'} data-test="DoubleQuotationMarkOption">
                Double Quotation Mark
              </Option>
            </Select>
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
}

EditParameterSettingsDialog.propTypes = {
  parameter: PropTypes.object.isRequired, // eslint-disable-line react/forbid-prop-types
  dialog: DialogPropType.isRequired,
  existingParams: PropTypes.arrayOf(PropTypes.string),
  parameters: PropTypes.array, // accepts parameters list for dependent-filters
};

EditParameterSettingsDialog.defaultProps = {
  existingParams: [],
  parameters: [],
};

export default wrapDialog(EditParameterSettingsDialog);
