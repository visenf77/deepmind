import { find, isArray, get, first, map, intersection, isEqual, isEmpty } from "lodash";
import React from "react";
import PropTypes from "prop-types";
import SelectWithVirtualScroll from "@/components/SelectWithVirtualScroll";

export default class DependentQueryBasedParameterInput extends React.Component {
  static propTypes = {
    parameter: PropTypes.any, // eslint-disable-line react/forbid-prop-types
    value: PropTypes.any, // eslint-disable-line react/forbid-prop-types
    mode: PropTypes.oneOf(["default", "multiple"]),
    queryId: PropTypes.number,
    onSelect: PropTypes.func,
    className: PropTypes.string,
    queryOptionValues: PropTypes.array, // the prop to use for custom options
  };

  static defaultProps = {
    value: null,
    mode: "default",
    parameter: null,
    queryId: null,
    onSelect: () => { },
    className: "",
    queryOptionValues: [],
  };

  constructor(props) {
    super(props);
    this.state = {
      options: [],
      value: null,
      loading: false,
    };
  }

  componentDidMount() {
    this._loadOptions(this.props.queryId);
    this.setValue(this.props.value);
  }

  componentDidUpdate(prevProps) {
    if (this.props.queryId !== prevProps.queryId) {
      this._loadOptions(this.props.queryId);
    }
    if (this.props.value !== prevProps.value) {
      this.setValue(this.props.value);
    }
    // If queryOptionValues changed, update options and value accordingly
    if (
      !isEqual(this.props.queryOptionValues, prevProps.queryOptionValues)
    ) {
      const { queryOptionValues } = this.props;
      // Normalize queryOptionValues to shape { value, name }
      const normalizedOptions = isArray(queryOptionValues) && queryOptionValues.length > 0
        ? map(queryOptionValues, v =>
            v && typeof v === "object" && "value" in v && "name" in v
              ? v
              : { value: v, name: v }
          )
        : [];
      this.setState({ options: normalizedOptions });
      this.setValue(this.props.value);
    }
  }

  setValue(value) {
    const { queryOptionValues } = this.props;

    let optionsToUse;
    if (queryOptionValues == null) { // strictly null or undefined
      optionsToUse = this.state.options;
    } else if (isArray(queryOptionValues) && queryOptionValues.length === 0) {
      optionsToUse = [];
    } else {
      optionsToUse = map(queryOptionValues, v =>
        v && typeof v === "object" && "value" in v && "name" in v
          ? v
          : { value: v, name: v }
      );
    }

    if (this.props.mode === "multiple") {
      value = isArray(value) ? value : [value];
      const optionValues = map(optionsToUse, option => option.value);
      const validValues = intersection(value, optionValues);
      this.setState({ value: validValues });
      return validValues;
    }
    const found = find(optionsToUse, option => option.value === this.props.value) !== undefined;
    value = found ? value : get(first(optionsToUse), "value");
    this.setState({ value });
    return value;
  }

  async _loadOptions(queryId) {
    if (queryId && queryId !== this.state.queryId) {
      this.setState({ loading: true });
      const options = await this.props.parameter.loadDropdownValues();

      // stale queryId check
      if (this.props.queryId === queryId) {
        this.setState({ options, loading: false }, () => {
          const updatedValue = this.setValue(this.props.value);
          if (!isEqual(updatedValue, this.props.value)) {
            this.props.onSelect(updatedValue);
          }
        });
      }
    }
  }

  render() {
    const { className, mode, onSelect, queryId, value, queryOptionValues, ...otherProps } = this.props;
    const { loading, options } = this.state;

    let displayOptions;
    if (queryOptionValues == null) {
      // queryOptionValues is null or undefined, fall back to state.options
      displayOptions = map(options, ({ value, name }) => ({ label: String(name), value }));
    } else if (isArray(queryOptionValues) && queryOptionValues.length === 0) {
      // queryOptionValues is empty array, show dropdown empty
      displayOptions = [];
    } else {
      // queryOptionValues is non-empty, show its values
      displayOptions = map(queryOptionValues, v =>
        v && typeof v === "object" && "value" in v && "name" in v
          ? { label: String(v.name), value: v.value }
          : { label: String(v), value: v }
      );
    }
    // console.log({ queryOptionValues, value }, this.state.value);

    return (
      <span>
        <SelectWithVirtualScroll
          className={className}
          disabled={loading}
          loading={loading}
          mode={mode}
          value={this.state.value}
          onChange={onSelect}
          options={displayOptions}
          showSearch
          showArrow
          notFoundContent={isEmpty(displayOptions) ? "No options available" : null}
          {...otherProps}
        />
      </span>
    );
  }
}
