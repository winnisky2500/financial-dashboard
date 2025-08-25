import React, { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

const THEME_KEY = "theme"; // 'light' | 'dark'

export default function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("dark");

  // 初始化：读取本地存储；默认跟你现在的深夜风格保持一致（dark）
  useEffect(() => {
    const saved = (localStorage.getItem(THEME_KEY) as "light" | "dark") || "dark";
    applyTheme(saved);
    setTheme(saved);
  }, []);

  const applyTheme = (mode: "light" | "dark") => {
    const root = document.documentElement;
    if (mode === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    localStorage.setItem(THEME_KEY, mode);
  };

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
  };

  return (
    <button
      onClick={toggle}
      className="fixed top-3 right-3 z-50 inline-flex items-center gap-2 px-3 py-2 rounded-xl border shadow
                 bg-[hsl(var(--card-bg))] text-[hsl(var(--sidebar-foreground))] border-[hsl(var(--card-border))] 
                 hover:opacity-90 focus:outline-none"
      title={theme === "dark" ? "切换到白天模式" : "切换到深夜模式"}
    >
      {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
      <span className="text-sm">{theme === "dark" ? "白天" : "深夜"}</span>
    </button>
  );
}
