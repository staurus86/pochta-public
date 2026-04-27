'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { NAV_ITEMS } from '@/lib/constants';
import {
  LayoutDashboard,
  Inbox,
  BarChart3,
  FileCode,
  Settings,
  Mail,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

const iconMap: Record<string, React.ElementType> = {
  LayoutDashboard,
  Inbox,
  BarChart3,
  FileCode,
  Settings,
};

interface SidebarProps {
  collapsed: boolean;
  onCollapse: (collapsed: boolean) => void;
}

export function Sidebar({ collapsed, onCollapse }: SidebarProps) {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 h-screen gradient-steel border-r border-steel-800 z-40 transition-all duration-200 flex flex-col',
        collapsed ? 'w-16' : 'w-56',
      )}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 h-14 border-b border-steel-800 shrink-0">
        <div className="w-8 h-8 rounded-md bg-accent-blue flex items-center justify-center shrink-0">
          <Mail className="w-4 h-4 text-white" />
        </div>
        {!collapsed && (
          <div className="overflow-hidden">
            <h1 className="text-sm font-bold text-white tracking-tight">Pochta CRM</h1>
            <p className="text-2xs text-steel-500">Email Intelligence</p>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto dark-scrollbar">
        {NAV_ITEMS.map((item) => {
          const Icon = iconMap[item.icon];
          const active = isActive(item.href);
          return (
            <Link
              key={item.key}
              href={item.href}
              className={cn(
                active ? 'steel-sidebar-item-active' : 'steel-sidebar-item',
                collapsed && 'justify-center px-0',
              )}
              title={collapsed ? item.label : undefined}
            >
              {Icon && <Icon className="w-[18px] h-[18px] shrink-0" />}
              {!collapsed && <span>{item.label}</span>}
              {active && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-accent-blue rounded-r-full" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Collapse toggle */}
      <div className="px-2 py-2 border-t border-steel-800 shrink-0">
        <button
          onClick={() => onCollapse(!collapsed)}
          className="steel-sidebar-item w-full justify-center"
        >
          {collapsed ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <>
              <ChevronLeft className="w-4 h-4" />
              <span>Свернуть</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
