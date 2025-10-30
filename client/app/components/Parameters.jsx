/* eslint-disable no-console */
import { size, filter, forEach, extend, isEmpty, isEqual } from "lodash";
import React from "react";
import PropTypes from "prop-types";
import { SortableContainer, SortableElement, DragHandle } from "@redash/viz/lib/components/sortable";
import location from "@/services/location";
import { Parameter, createParameter } from "@/services/parameters";
import ParameterApplyButton from "@/components/ParameterApplyButton";
import ParameterValueInput from "@/components/ParameterValueInput";
import PlainButton from "@/components/PlainButton";
import EditParameterSettingsDialog from "./EditParameterSettingsDialog";
import { toHuman } from "@/lib/utils";

import "./Parameters.less";

function updateUrl(parameters) {
  const params = extend({}, location.search);
  parameters.forEach((param) => {
    extend(params, param.toUrlParams());
  });
  location.setSearch(params, true);
}

export default class Parameters extends React.Component {
  static propTypes = {
    parameters: PropTypes.arrayOf(PropTypes.instanceOf(Parameter)),
    editable: PropTypes.bool,
    sortable: PropTypes.bool,
    disableUrlUpdate: PropTypes.bool,
    onValuesChange: PropTypes.func,
    onPendingValuesChange: PropTypes.func,
    onParametersEdit: PropTypes.func,
    appendSortableToParent: PropTypes.bool,
    // queryParamValues is intentionally not included in props
  };

  static defaultProps = {
    parameters: [],
    editable: false,
    sortable: false,
    disableUrlUpdate: false,
    onValuesChange: () => { },
    onPendingValuesChange: () => { },
    onParametersEdit: () => { },
    appendSortableToParent: true,
    // no queryParamValues in defaultProps
  };

  toCamelCase = (str) => {
    if (isEmpty(str)) {
      return "";
    }
    return str.replace(/\s+/g, "").toLowerCase();
  };

  constructor(props) {
    super(props);
    const { parameters, disableUrlUpdate } = props;
    this.state = {
      parameters,
      queryParamValues: {},
    };
    if (!disableUrlUpdate) {
      updateUrl(parameters);
    }
    const hideRegex = /hide_filter=([^&]+)/g;
    const matches = window.location.search.matchAll(hideRegex);
    this.hideValues = Array.from(matches, (match) => match[1]);
  }

  componentDidUpdate = (prevProps) => {
    const { parameters, disableUrlUpdate } = this.props;
    const parametersChanged = prevProps.parameters !== parameters;
    const disableUrlUpdateChanged = prevProps.disableUrlUpdate !== disableUrlUpdate;

    if (parametersChanged && parameters !== this.state.parameters) {
      this.setState({ parameters });
    }
    if ((parametersChanged || disableUrlUpdateChanged) && !disableUrlUpdate) {
      updateUrl(parameters);
    }
   
  };

  handleKeyDown = (e) => {
    if (e.keyCode === 13 && (e.ctrlKey || e.metaKey || e.altKey)) {
      e.stopPropagation();
      this.applyChanges();
    }
  };

  // Optimized updateDescendantValue: updates children when parent is updated, with less logging and better async handling

  updateDescendantValue = async (param, updatedQueryParamValues, updatedParameters, parentValue, parentName) => {
    if (!Array.isArray(param.parent_parameter)) return;

    // Update the correct parent_parameter value for this param
    param.parent_parameter = param.parent_parameter.map(pp =>
      pp && pp.name === parentName ? { ...pp, value: parentValue } : pp
    );

    const name = param.name;
    const paramOptions = await param.loadDropdownValues();

    updatedQueryParamValues[name] = paramOptions || [];

    let newValue = null;
    if (Array.isArray(paramOptions) && paramOptions.length > 0) {
      newValue = paramOptions[0].value !== undefined ? paramOptions[0].value : paramOptions[0];
      param.setPendingValue(newValue !== undefined ? newValue : null);
    } else {
      param.setPendingValue(null);
    }

    // Sync param updates in the parameters array
    updatedParameters = updatedParameters.map(up =>
      up && up.name === name ? { ...param } : up
    );

    // Find children that depend on this param
    const childParameters = Array.isArray(updatedParameters)
      ? updatedParameters.filter(child =>
          Array.isArray(child.parent_parameter) &&
          child.parent_parameter.some(pp => pp && pp.name === name)
        )
      : [];

    // Recursively update children, immediately async/await for sequential updates
    for (const childParam of childParameters) {
      await this.updateDescendantValue(
        childParam,
        updatedQueryParamValues,
        updatedParameters,
        newValue,
        name
      );
    }
  }

  setPendingValue = async (param, value, isDirty) => {
    const { onPendingValuesChange } = this.props;
    const { parameters, queryParamValues } = this.state;
   

    if (isDirty) {
      param.setPendingValue(value);
    } else {
      param.clearPendingValue();
    }

    let updatedQueryParamValues = { ...queryParamValues };
    let updatedParameters = [...parameters];

    // Find direct children of this param and update them
    const childParameters = Array.isArray(parameters)
      ? parameters.filter(
          child =>
            Array.isArray(child.parent_parameter) &&
            child.parent_parameter.some(pp => pp && pp.name === param.name)
        )
      : [];

    if (childParameters.length > 0) {
      // For each direct child, update it and its descendants sequentially
      for (const childParam of childParameters) {
        await this.updateDescendantValue(
          childParam,
          updatedQueryParamValues,
          updatedParameters,
          value,
          param.name
        );
      }
    }

    this.setState(
      {
        parameters: updatedParameters,
        queryParamValues: updatedQueryParamValues,
      },
      onPendingValuesChange
    );
  };

  moveParameter = ({ oldIndex, newIndex }) => {
    const { onParametersEdit } = this.props;
    if (oldIndex !== newIndex) {
      this.setState(({ parameters }) => {
        parameters.splice(newIndex, 0, parameters.splice(oldIndex, 1)[0]);
        onParametersEdit(parameters);
        return { parameters };
      });
    }
  };

  applyChanges = () => {
    const { onValuesChange, disableUrlUpdate } = this.props;
    this.setState(({ parameters }) => {
      const parametersWithPendingValues = parameters.filter((p) => p.hasPendingValue);
      forEach(parameters, (p) => p.applyPendingValue());
      if (!disableUrlUpdate) {
        updateUrl(parameters);
      }
      onValuesChange(parametersWithPendingValues);
      return { parameters };
    });
  };

  showParameterSettings = (parameter, index) => {
    const { parameters } = this.state;
    const { onParametersEdit } = this.props;
    console.log({ parameter, parameters });

    EditParameterSettingsDialog.showModal({ parameter, parameters }).onClose((updated) => {
      this.setState(({ parameters }) => {
        const updatedParameter = extend(parameter, updated);
        console.log({ updatedParameter });
        parameters[index] = createParameter(updatedParameter, updatedParameter.parentQueryId);
        onParametersEdit(parameters);
        return { parameters };
      });
    });
  };

  renderParameter(param, index) {
    if (this.hideValues.some((value) => this.toCamelCase(value) === this.toCamelCase(param.name))) {
      return null;
    }
    const { editable } = this.props;
    const { queryParamValues } = this.state;
    if (param.hidden) {
      return null;
    }

    // Determine queryOptionValues: send only if queryParamValues has property param.name, otherwise send as null
    let queryOptionValues = null;
    if (
      param.type === "dependent-filters" &&
      queryParamValues &&
      Object.prototype.hasOwnProperty.call(queryParamValues, param.name)
    ) {
      queryOptionValues = queryParamValues[param.name];
    }

    return (
      <div key={param.name} className="di-block" data-test={`ParameterName-${param.name}`}>
        <div className="parameter-heading">
          <label>{param.title || toHuman(param.name)}</label>
          {editable && (
            <PlainButton
              className="btn btn-default btn-xs m-l-5"
              aria-label="Edit"
              onClick={() => this.showParameterSettings(param, index)}
              data-test={`ParameterSettings-${param.name}`}
              type="button">
              <i className="fa fa-cog" aria-hidden="true" />
            </PlainButton>
          )}
        </div>

        <ParameterValueInput
          type={param.type}
          value={param.normalizedValue}
          queryOptionValues={queryOptionValues}
          parameter={param}
          enumOptions={param.enumOptions}
          queryId={param.queryId}
          onSelect={(v, isDirty) => this.setPendingValue(param, v, isDirty)}
          regex={param.regex}
        />
      </div>
    );
  }

  render() {
    const { parameters } = this.state;
    const { sortable, appendSortableToParent } = this.props;
    const dirtyParamCount = size(filter(parameters, "hasPendingValue"));
    return (
      <SortableContainer
        disabled={!sortable}
        axis="xy"
        useDragHandle
        lockToContainerEdges
        helperClass="parameter-dragged"
        helperContainer={(containerEl) => (appendSortableToParent ? containerEl : document.body)}
        updateBeforeSortStart={this.onBeforeSortStart}
        onSortEnd={this.moveParameter}
        containerProps={{
          className: "parameter-container",
          onKeyDown: dirtyParamCount ? this.handleKeyDown : null,
        }}
      >
        {parameters &&
          parameters.map((param, index) => (
            <SortableElement key={param.name} index={index}>
              <div
                className="parameter-block"
                data-editable={sortable || null}
                data-test={`ParameterBlock-${param.name}`}
              >
                {sortable && <DragHandle data-test={`DragHandle-${param.name}`} />}
                {this.renderParameter(param, index)}
              </div>
            </SortableElement>
          ))}
        <ParameterApplyButton onClick={this.applyChanges} paramCount={dirtyParamCount} />
      </SortableContainer>
    );
  }
}
