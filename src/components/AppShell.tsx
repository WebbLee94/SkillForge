import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { ToastProvider } from "./ToastProvider";

export function AppShell() {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
      <ToastProvider />
    </div>
  );
}
