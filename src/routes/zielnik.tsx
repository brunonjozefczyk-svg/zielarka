import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/zielnik")({
  component: ZielnikLayout,
});

function ZielnikLayout() {
  return <Outlet />;
}