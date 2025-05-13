import "./styles.css";
import { createRoot } from "react-dom/client";
import App from "./app";
import { Providers } from "@/providers";

// React Router imports
import { createBrowserRouter, RouterProvider } from "react-router-dom";

import AgentInfoPage from "./pages/AgentInfoPage";

// Create the browser router with application routes
const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
  },
  {
    path: "/agent",
    element: <p>Agent</p>,
  },
  {
    path: "/agent/:id",
    element: <AgentInfoPage />,
  },
]);

const root = createRoot(document.getElementById("app")!);

root.render(
  <Providers>
    <div className="bg-neutral-50 text-base text-neutral-900 antialiased transition-colors selection:bg-blue-700 selection:text-white dark:bg-neutral-950 dark:text-neutral-100">
      <RouterProvider router={router} />
    </div>
  </Providers>
);
