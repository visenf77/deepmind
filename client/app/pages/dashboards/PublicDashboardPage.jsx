/* eslint-disable no-console */
/**
 * PublicDashboardPage Component
 * 
 * Supports two URL patterns:
 * 1. /public/dashboards/:token - Standard public dashboard
 * 2. /public/dashboards/:token/company/:companyGuid - Public dashboard with company filtering
 * 
 * When companyGuid is provided (format: E_*), the component:
 * 1. Passes the companyGuid as a filter prop to the dashboard
 * 2. The dashboard queries can use the companyGuid filter directly in their WHERE clauses
 * 3. Displays the dashboard with the company filter applied
 */
import { isEmpty } from "lodash";
import React from "react";
import PropTypes from "prop-types";

import routeWithApiKeySession from "@/components/ApplicationArea/routeWithApiKeySession";
import Link from "@/components/Link";
import BigMessage from "@/components/BigMessage";
import PageHeader from "@/components/PageHeader";
import Parameters from "@/components/Parameters";
import DashboardGrid from "@/components/dashboards/DashboardGrid";
import Filters from "@/components/Filters";

import { Dashboard } from "@/services/dashboard";
import routes from "@/services/routes";

import logoUrl from "@/assets/images/redash_icon_small.png";

import useDashboard from "./hooks/useDashboard";

import "./PublicDashboardPage.less";

function PublicDashboard({ dashboard, companyGuid }) {
  const { globalParameters, filters, setFilters, refreshDashboard, loadWidget, refreshWidget, visibleWidgets } = useDashboard(
    dashboard,
    companyGuid
  );
  
  

  return (
    <div className="container p-t-10 p-b-20">
      <PageHeader title={dashboard.name} />
      {!isEmpty(globalParameters) && (
        <div className="m-b-10 p-15 bg-white tiled">
          <Parameters parameters={globalParameters} onValuesChange={refreshDashboard} />
        </div>
      )}
      {!isEmpty(filters) && (
        <div className="m-b-10 p-15 bg-white tiled">
          <Filters filters={filters} onChange={setFilters} />
        </div>
      )}
      <div id="dashboard-container">
        <DashboardGrid
          dashboard={dashboard}
          widgets={visibleWidgets}
          filters={filters}
          isEditing={false}
          isPublic
          onLoadWidget={loadWidget}
          onRefreshWidget={refreshWidget}
        />
      </div>
    </div>
  );
}

PublicDashboard.propTypes = {
  dashboard: PropTypes.object.isRequired, // eslint-disable-line react/forbid-prop-types
  companyGuid: PropTypes.string,
};

class PublicDashboardPage extends React.Component {
  static propTypes = {
    token: PropTypes.string.isRequired,
    companyGuid: PropTypes.string,
    onError: PropTypes.func,
  };

  static defaultProps = {
    companyGuid: null,
    onError: () => {},
  };

  state = {
    loading: true,
    dashboard: null,
  };


  async componentDidMount() {
    // Log the token
    // eslint-disable-next-line no-console
    console.log("PublicDashboardPage: token =", this.props.token);
    // eslint-disable-next-line no-console
    console.log("PublicDashboardPage: companyGuid =", this.props.companyGuid);

    try {
      const dashboard = await Dashboard.getByToken({ token: this.props.token });
      
      // Log the dashboard object
      // eslint-disable-next-line no-console
      console.log("PublicDashboardPage: dashboard =", dashboard);

      this.setState({ dashboard, loading: false });
    } catch (error) {
      this.props.onError(error);
    }
  }
  

  render() {
    const { loading, dashboard } = this.state;
    return (
      <div className="public-dashboard-page">
        {loading ? (
          <div className="container loading-message">
            <BigMessage className="" icon="fa-spinner fa-2x fa-pulse" message="Loading..." />
          </div>
        ) : (
          <PublicDashboard dashboard={dashboard} companyGuid={this.props.companyGuid} />
        )}
      </div>
    );
  }
}

routes.register(
  "Dashboards.ViewShared",
  routeWithApiKeySession({
    path: "/public/dashboards/:token",
    render: pageProps => <PublicDashboardPage {...pageProps} />,
    getApiKey: currentRoute => currentRoute.routeParams.token,
  })
);

routes.register(
  "Dashboards.ViewPublicWithCompany",
  routeWithApiKeySession({
    path: "/public/dashboards/:token/company/:companyGuid",
    render: pageProps => <PublicDashboardPage {...pageProps} />,
    getApiKey: currentRoute => currentRoute.routeParams.token,
  })
);
