import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { SessionProvider } from "@/lib/sessionContext";
import Index from "./pages/Index";
import Login from "./pages/Login";
import Session from "./pages/Session";
import Admin from "./pages/Admin";
import DemoLogins from "./pages/DemoLogins";
import Unsubscribe from "./pages/Unsubscribe";
import NotFound from "./pages/NotFound";
import HelpButton from "./components/HelpButton";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <SessionProvider>
        <Toaster />
        <Sonner />
        <HelpButton />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/login" element={<Login />} />
            <Route path="/session/:id" element={<Session />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/demo-logins" element={<DemoLogins />} />
            <Route path="/unsubscribe" element={<Unsubscribe />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </SessionProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
