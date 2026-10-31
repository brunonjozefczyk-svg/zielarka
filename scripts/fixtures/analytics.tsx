// Isolated browser fixture: no CMS, secrets, messages or live Google services.
import React from "react";
import { createRoot } from "react-dom/client";
import { createRootRoute, createRoute, createRouter, RouterProvider, Link, Outlet } from "@tanstack/react-router";
import { AnalyticsConsent } from "../../src/components/AnalyticsConsent";
const root = createRootRoute({ component: () => <><nav><Link to="/">Start</Link><Link to="/kontakt">Kontakt</Link><Link to="/konsultacje">Konsultacje</Link><Link to="/edytuj">Edytor</Link></nav><Outlet /><AnalyticsConsent measurementId="G-TEST123" /></> });
const children = ["/", "/kontakt", "/konsultacje", "/edytuj"].map(path => createRoute({ getParentRoute: () => root, path, component: () => <h1>Test</h1> }));
const router = createRouter({ routeTree: root.addChildren(children) });
createRoot(document.getElementById("root")!).render(<React.StrictMode><RouterProvider router={router} /></React.StrictMode>);
