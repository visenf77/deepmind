import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { isEmpty, includes, compact, map, has, pick, keys, extend, every, get } from "lodash";
import notification from "@/services/notification";
import location from "@/services/location";
import url from "@/services/url";
import { Dashboard, collectDashboardFilters } from "@/services/dashboard";
import { currentUser } from "@/services/auth";
import recordEvent from "@/services/recordEvent";
import { QueryResultError } from "@/services/query";
import AddWidgetDialog from "@/components/dashboards/AddWidgetDialog";
import TextboxDialog from "@/components/dashboards/TextboxDialog";
import PermissionsEditorDialog from "@/components/PermissionsEditorDialog";
import { editableMappingsToParameterMappings, synchronizeWidgetTitles } from "@/components/ParameterMappingInput";
import ShareDashboardDialog from "../components/ShareDashboardDialog";
import useFullscreenHandler from "../../../lib/hooks/useFullscreenHandler";
import useRefreshRateHandler from "./useRefreshRateHandler";
import useEditModeHandler from "./useEditModeHandler";
import useDuplicateDashboard from "./useDuplicateDashboard";
import { policy } from "@/services/policy";

export { DashboardStatusEnum } from "./useEditModeHandler";

function getAffectedWidgets(widgets, updatedParameters = []) {
  return !isEmpty(updatedParameters)
    ? widgets.filter((widget) =>
        Object.values(widget.getParameterMappings())
          .filter(({ type }) => type === "dashboard-level")
          .some(({ mapTo }) =>
            includes(
              updatedParameters.map((p) => p.name),
              mapTo
            )
          )
      )
    : widgets;
}

function useDashboard(dashboardData, companyGuid = null) {
  const [dashboard, setDashboard] = useState(dashboardData);
  const [filters, setFilters] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [gridDisabled, setGridDisabled] = useState(false);
  const [currentEntityId, setCurrentEntityId] = useState(null);
  const globalParameters = useMemo(() => dashboard.getParametersDefs(), [dashboard]);
  const canEditDashboard = !dashboard.is_archived && policy.canEdit(dashboard);
  const isDashboardOwnerOrAdmin = useMemo(
    () =>
      !dashboard.is_archived &&
      has(dashboard, "user.id") &&
      (currentUser.id === dashboard.user.id || currentUser.isAdmin),
    [dashboard]
  );
  const hasOnlySafeQueries = useMemo(
    () => every(dashboard.widgets, (w) => (w.getQuery() ? w.getQuery().is_safe : true)),
    [dashboard]
  );

  const [isDuplicating, duplicateDashboard] = useDuplicateDashboard(dashboard);

  const managePermissions = useCallback(() => {
    const aclUrl = `api/dashboards/${dashboard.id}/acl`;
    PermissionsEditorDialog.showModal({
      aclUrl,
      context: "dashboard",
      author: dashboard.user,
    });
  }, [dashboard]);

  const updateDashboard = useCallback(
    (data, includeVersion = true) => {
      setDashboard((currentDashboard) => extend({}, currentDashboard, data));
      data = { ...data, id: dashboard.id };
      if (includeVersion) {
        data = { ...data, version: dashboard.version };
      }
      return Dashboard.save(data)
        .then((updatedDashboard) => {
          setDashboard((currentDashboard) => extend({}, currentDashboard, pick(updatedDashboard, keys(data))));
          if (has(data, "name")) {
            location.setPath(url.parse(updatedDashboard.url).pathname, true);
          }
        })
        .catch((error) => {
          const status = get(error, "response.status");
          if (status === 403) {
            notification.error("Dashboard update failed", "Permission Denied.");
          } else if (status === 409) {
            notification.error(
              "It seems like the dashboard has been modified by another user. ",
              "Please copy/backup your changes and reload this page.",
              { duration: null }
            );
          }
        });
    },
    [dashboard]
  );

  const togglePublished = useCallback(() => {
    recordEvent("toggle_published", "dashboard", dashboard.id);
    updateDashboard({ is_draft: !dashboard.is_draft }, false);
  }, [dashboard, updateDashboard]);

  const loadWidget = useCallback(
    (widget, forceRefresh = false, entityId = null) => {
      widget.getParametersDefs(); // Force widget to read parameters values from URL

      if (widget.getQuery()) {
        const query = widget.getQuery();
        const parameters = query.getParameters();
        const paramDefs = parameters.get();

        // Apply companyGuid as parameter if provided (for entity widget)
        if (companyGuid) {
          const companyGuidParam = paramDefs.find(
            (param) => param.name === "companyGuid" || param.title === "companyGuid" || param.name === "gu_id"
          );

          if (companyGuidParam) {
            companyGuidParam.setValue(companyGuid);
          }
        }

        // Apply entityId as parameter if provided (for other widgets)
        if (entityId) {
          const entityIdParam = paramDefs.find(
            (param) => param.name === "entity Id" || param.title === "entity Id" || param.name === "entityId"
          );

          if (entityIdParam) {
            entityIdParam.setValue(parseInt(entityId, 10));
            console.log(`Setting entityId parameter to: ${entityId} for widget query: ${query.name}`);
          }
        }
      }

      setDashboard((currentDashboard) => extend({}, currentDashboard));
      return widget
        .load(forceRefresh)
        .catch((error) => {
          // QueryResultErrors are expected
          if (error instanceof QueryResultError) {
            return;
          }
          return Promise.reject(error);
        })
        .finally(() => setDashboard((currentDashboard) => extend({}, currentDashboard)));
    },
    [companyGuid]
  );

  const refreshWidget = useCallback((widget) => loadWidget(widget, true), [loadWidget]);

  const removeWidget = useCallback((widgetId) => {
    setDashboard((currentDashboard) =>
      extend({}, currentDashboard, {
        widgets: currentDashboard.widgets.filter((widget) => widget.id !== undefined && widget.id !== widgetId),
      })
    );
  }, []);

  const dashboardRef = useRef();
  dashboardRef.current = dashboard;

  const loadEntityWidgetAndApplyFilters = useCallback(
    async (entityWidget, affectedWidgets, forceRefresh, updatedParameters) => {
      // First, load the entity widget with companyGuid
      const entityQuery = entityWidget.getQuery();
      const parameters = entityQuery.getParameters();
      const paramDefs = parameters.get();

      // Set companyGuid parameter
      const companyGuidParam = paramDefs.find(
        (param) => param.name === "companyGuid" || param.title === "companyGuid" || param.name === "gu_id"
      );

      if (companyGuidParam) {
        companyGuidParam.setValue(companyGuid);
      }

      // Load the entity widget
      await entityWidget.load(forceRefresh);

      // Extract entityId from the entity widget result
      const entityResult = entityWidget.getQueryResult();
      let entityId = null;

      if (entityResult && entityResult.query_result.data.rows && entityResult.query_result.data.rows.length > 0) {
        const firstRow = entityResult.query_result.data.rows[0];
        console.log("Entity widget result row:", firstRow);

        // Look for entityId, company_id, or similar fields
        entityId = firstRow.entityId || firstRow.company_id || firstRow.entity_id || firstRow.id;

       if (entityId) {
         console.log(`Found entityId: ${entityId} from entity widget`);
         
         // Check if entityId has changed
         if (currentEntityId !== entityId) {
           console.log(`EntityId changed from ${currentEntityId} to ${entityId}. Refreshing all widgets.`);
           setCurrentEntityId(entityId);
         }
       } else {
         console.warn("No entityId found in entity widget result. Available fields:", Object.keys(firstRow));
         if (currentEntityId !== null) {
           console.log("EntityId cleared. Refreshing all widgets.");
           setCurrentEntityId(null);
         }
       }
      } else {
        console.warn("Entity widget returned no results or empty result");
      }

       // Now load other widgets with entityId as static filter
       const otherWidgets = affectedWidgets.filter((widget) => widget !== entityWidget);
       const loadWidgetPromises = compact(
         otherWidgets.map((widget) => loadWidget(widget, forceRefresh, entityId).catch((error) => error))
       );

       await Promise.all(loadWidgetPromises);
       
       // If entityId was found, trigger a refresh of all widgets to ensure they get the new value
       if (entityId) {
         console.log(`Refreshing all widgets with entityId: ${entityId}`);
         const allOtherWidgets = dashboardRef.current.widgets.filter((widget) => widget !== entityWidget);
         const refreshPromises = compact(
           allOtherWidgets.map((widget) => loadWidget(widget, true, entityId).catch((error) => error))
         );
         await Promise.all(refreshPromises);
       }

      // Collect filters and apply entityId
      const queryResults = compact(map(dashboardRef.current.widgets, (widget) => widget.getQueryResult()));
      let updatedFilters = collectDashboardFilters(dashboardRef.current, queryResults, location.search);

       // Don't show entity Id as a filter - just pass the value to widgets
       // Filter out any "entity Id" filters from the UI
       updatedFilters = updatedFilters.filter(
         (filter) => filter.name !== "entity Id" && filter.friendlyName !== "entity Id"
       );

      setFilters(updatedFilters);
     },
     [companyGuid, loadWidget, currentEntityId]
   );

  const loadDashboard = useCallback(
    (forceRefresh = false, updatedParameters = []) => {
      const affectedWidgets = getAffectedWidgets(dashboardRef.current.widgets, updatedParameters);

      // If companyGuid is provided, find the "entity" widget and load it first
      if (companyGuid) {
        const entityWidget = dashboardRef.current.widgets.find(
          (widget) => widget.getQuery() && widget.getQuery().name && widget.getQuery().name.toLowerCase() === "entity"
        );

        if (entityWidget) {
          // Load the entity widget first with companyGuid
          return loadEntityWidgetAndApplyFilters(entityWidget, affectedWidgets, forceRefresh, updatedParameters);
        }
      }

      // Normal loading for other widgets
      const loadWidgetPromises = compact(
        affectedWidgets.map((widget) => loadWidget(widget, forceRefresh).catch((error) => error))
      );

      return Promise.all(loadWidgetPromises).then(() => {
        const queryResults = compact(map(dashboardRef.current.widgets, (widget) => widget.getQueryResult()));
        const updatedFilters = collectDashboardFilters(dashboardRef.current, queryResults, location.search);

        setFilters(updatedFilters);
      });
    },
    [loadWidget, companyGuid]
  );

  const refreshDashboard = useCallback(
    (updatedParameters) => {
      if (!refreshing) {
        setRefreshing(true);
        loadDashboard(true, updatedParameters).finally(() => setRefreshing(false));
      }
    },
    [refreshing, loadDashboard]
  );

  const archiveDashboard = useCallback(() => {
    recordEvent("archive", "dashboard", dashboard.id);
    Dashboard.delete(dashboard).then((updatedDashboard) =>
      setDashboard((currentDashboard) => extend({}, currentDashboard, pick(updatedDashboard, ["is_archived"])))
    );
  }, [dashboard]); // eslint-disable-line react-hooks/exhaustive-deps

  const showShareDashboardDialog = useCallback(() => {
    const handleDialogClose = () => setDashboard((currentDashboard) => extend({}, currentDashboard));

    ShareDashboardDialog.showModal({
      dashboard,
      hasOnlySafeQueries,
    })
      .onClose(handleDialogClose)
      .onDismiss(handleDialogClose);
  }, [dashboard, hasOnlySafeQueries]);

  const showAddTextboxDialog = useCallback(() => {
    TextboxDialog.showModal({
      isNew: true,
    }).onClose((text) =>
      dashboard.addWidget(text).then(() => setDashboard((currentDashboard) => extend({}, currentDashboard)))
    );
  }, [dashboard]);

  const showAddWidgetDialog = useCallback(() => {
    AddWidgetDialog.showModal({
      dashboard,
    }).onClose(({ visualization, parameterMappings }) =>
      dashboard
        .addWidget(visualization, {
          parameterMappings: editableMappingsToParameterMappings(parameterMappings),
        })
        .then((widget) => {
          const widgetsToSave = [
            widget,
            ...synchronizeWidgetTitles(widget.options.parameterMappings, dashboard.widgets),
          ];
          return Promise.all(widgetsToSave.map((w) => w.save())).then(() =>
            setDashboard((currentDashboard) => extend({}, currentDashboard))
          );
        })
    );
  }, [dashboard]);

  const [refreshRate, setRefreshRate, disableRefreshRate] = useRefreshRateHandler(refreshDashboard);
  const [fullscreen, toggleFullscreen] = useFullscreenHandler();
  const editModeHandler = useEditModeHandler(!gridDisabled && canEditDashboard, dashboard.widgets);

  useEffect(() => {
    setDashboard(dashboardData);
    loadDashboard();
  }, [dashboardData]); // eslint-disable-line react-hooks/exhaustive-deps

  // Monitor entityId changes and refresh widgets when it changes
  useEffect(() => {
    if (currentEntityId !== null && companyGuid) {
      console.log(`EntityId changed to: ${currentEntityId}. Refreshing all non-entity widgets.`);
      const entityWidget = dashboard.widgets.find(
        (widget) => widget.getQuery() && widget.getQuery().name && widget.getQuery().name.toLowerCase() === "entity"
      );
      
      if (entityWidget) {
        const otherWidgets = dashboard.widgets.filter((widget) => widget !== entityWidget);
        otherWidgets.forEach((widget) => {
          loadWidget(widget, true, currentEntityId);
        });
      }
    }
  }, [currentEntityId, companyGuid, dashboard.widgets, loadWidget]);

  useEffect(() => {
    document.title = dashboard.name;
  }, [dashboard.name]);

  // reload dashboard when filter option changes
  useEffect(() => {
    loadDashboard();
  }, [dashboard.dashboard_filters_enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  // Filter out entity widget from display in public dashboards
  const visibleWidgets = useMemo(() => {
    if (!companyGuid) {
      // Not a public dashboard with company filtering, show all widgets
      return dashboard.widgets;
    }
    
    // For public dashboards with company filtering, hide the entity widget
    return dashboard.widgets.filter(
      (widget) => {
        const query = widget.getQuery();
        if (!query || !query.name) {
          return true; // Keep widgets without queries
        }
        // Hide widgets with "entity" in the name (case-insensitive)
        return !query.name.toLowerCase().includes('entity');
      }
    );
  }, [dashboard.widgets, companyGuid]);

  return {
    dashboard,
    globalParameters,
    refreshing,
    filters,
    setFilters,
    loadDashboard,
    refreshDashboard,
    updateDashboard,
    togglePublished,
    archiveDashboard,
    loadWidget,
    refreshWidget,
    removeWidget,
    canEditDashboard,
    isDashboardOwnerOrAdmin,
    refreshRate,
    setRefreshRate,
    disableRefreshRate,
    ...editModeHandler,
    gridDisabled,
    setGridDisabled,
    fullscreen,
    toggleFullscreen,
    showShareDashboardDialog,
    showAddTextboxDialog,
    showAddWidgetDialog,
    managePermissions,
    isDuplicating,
    duplicateDashboard,
    visibleWidgets, // Add filtered widgets for display
  };
}

export default useDashboard;
