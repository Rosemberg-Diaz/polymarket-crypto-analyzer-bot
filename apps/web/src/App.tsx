import { useMemo, useState } from "react";
import {
  AppBar,
  Box,
  CssBaseline,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ThemeProvider,
  Toolbar,
  Typography,
  createTheme
} from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import DashboardIcon from "@mui/icons-material/Dashboard";
import ArticleIcon from "@mui/icons-material/Article";
import InsightsIcon from "@mui/icons-material/Insights";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import StorefrontIcon from "@mui/icons-material/Storefront";
import PsychologyIcon from "@mui/icons-material/Psychology";
import HealthAndSafetyIcon from "@mui/icons-material/HealthAndSafety";
import { DashboardPage } from "./pages/DashboardPage";
import { LogsPage } from "./pages/LogsPage";
import { PredictionsPage } from "./pages/PredictionsPage";
import { TradesPage } from "./pages/TradesPage";
import { MarketsPage } from "./pages/MarketsPage";
import { LearningPage } from "./pages/LearningPage";
import { HealthPage } from "./pages/HealthPage";

const drawerWidth = 260;

const pages = [
  { key: "dashboard", label: "Dashboard", icon: <DashboardIcon />, component: <DashboardPage /> },
  { key: "logs", label: "Logs", icon: <ArticleIcon />, component: <LogsPage /> },
  { key: "predictions", label: "Predictions", icon: <InsightsIcon />, component: <PredictionsPage /> },
  { key: "trades", label: "Trades", icon: <ReceiptLongIcon />, component: <TradesPage /> },
  { key: "markets", label: "Markets", icon: <StorefrontIcon />, component: <MarketsPage /> },
  { key: "learning", label: "Learning", icon: <PsychologyIcon />, component: <LearningPage /> },
  { key: "health", label: "Health", icon: <HealthAndSafetyIcon />, component: <HealthPage /> }
];

const theme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#0f766e" },
    secondary: { main: "#2563eb" },
    background: { default: "#f7f8fa" }
  },
  typography: {
    fontFamily: "Inter, Segoe UI, Arial, sans-serif",
    h4: { letterSpacing: 0 }
  },
  components: {
    MuiCard: {
      styleOverrides: {
        root: {
          boxShadow: "none"
        }
      }
    }
  }
});

export default function App() {
  const [currentPage, setCurrentPage] = useState("dashboard");
  const [mobileOpen, setMobileOpen] = useState(false);
  const activePage = useMemo(() => pages.find((page) => page.key === currentPage) ?? pages[0], [currentPage]);

  const drawer = (
    <Box>
      <Toolbar>
        <Box>
          <Typography variant="subtitle1" fontWeight={800}>
            Polymarket Crypto
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Local monitor
          </Typography>
        </Box>
      </Toolbar>
      <Divider />
      <List>
        {pages.map((page) => (
          <ListItemButton
            key={page.key}
            selected={page.key === currentPage}
            onClick={() => {
              setCurrentPage(page.key);
              setMobileOpen(false);
            }}
          >
            <ListItemIcon>{page.icon}</ListItemIcon>
            <ListItemText primary={page.label} />
          </ListItemButton>
        ))}
      </List>
    </Box>
  );

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ display: "flex", minHeight: "100vh" }}>
        <AppBar
          position="fixed"
          color="inherit"
          elevation={0}
          sx={{ width: { md: `calc(100% - ${drawerWidth}px)` }, ml: { md: `${drawerWidth}px` }, borderBottom: "1px solid", borderColor: "divider" }}
        >
          <Toolbar>
            <IconButton color="inherit" edge="start" onClick={() => setMobileOpen(true)} sx={{ mr: 2, display: { md: "none" } }}>
              <MenuIcon />
            </IconButton>
            <Typography variant="h6" fontWeight={800}>
              {activePage.label}
            </Typography>
          </Toolbar>
        </AppBar>
        <Box component="nav" sx={{ width: { md: drawerWidth }, flexShrink: { md: 0 } }}>
          <Drawer
            variant="temporary"
            open={mobileOpen}
            onClose={() => setMobileOpen(false)}
            ModalProps={{ keepMounted: true }}
            sx={{ display: { xs: "block", md: "none" }, "& .MuiDrawer-paper": { width: drawerWidth } }}
          >
            {drawer}
          </Drawer>
          <Drawer
            variant="permanent"
            sx={{ display: { xs: "none", md: "block" }, "& .MuiDrawer-paper": { width: drawerWidth, boxSizing: "border-box" } }}
            open
          >
            {drawer}
          </Drawer>
        </Box>
        <Box component="main" sx={{ flexGrow: 1, p: { xs: 2, md: 3 }, width: { md: `calc(100% - ${drawerWidth}px)` } }}>
          <Toolbar />
          {activePage.component}
        </Box>
      </Box>
    </ThemeProvider>
  );
}
