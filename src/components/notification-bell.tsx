"use client";

import { Bell, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type NotificationItem = { id: string; title: string; body: string; readAt: string | null; createdAt: string };

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function load() {
      try {
        const response = await fetch("/api/notifications", { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json();
        setItems(payload.notifications ?? []);
        setUnreadCount(payload.unreadCount ?? 0);
      } catch {
        // Silent -- the bell just stays at its last known count until the next poll succeeds.
      }
    }

    const interval = window.setInterval(load, 60_000);
    void load();
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!open) return;
    function handleClick(event: MouseEvent) {
      if (ref.current?.contains(event.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [open]);

  async function markRead(id: string) {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, readAt: new Date().toISOString() } : item)));
    setUnreadCount((current) => Math.max(0, current - 1));
    await fetch(`/api/notifications/${id}`, { method: "PATCH" }).catch(() => {});
  }

  async function markAllRead() {
    const unread = items.filter((item) => !item.readAt);
    if (unread.length === 0) return;
    setLoading(true);
    try {
      await Promise.all(unread.map((item) => fetch(`/api/notifications/${item.id}`, { method: "PATCH" })));
      setItems((current) => current.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })));
      setUnreadCount(0);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="notification-bell" ref={ref}>
      <button type="button" aria-label="Notifications" className="notification-bell-trigger" onClick={() => setOpen((current) => !current)}>
        <Bell size={17} />
        {unreadCount > 0 ? <span className="notification-bell-badge">{unreadCount > 9 ? "9+" : unreadCount}</span> : null}
      </button>
      {open ? (
        <div className="notification-bell-panel">
          <div className="notification-bell-header">
            <strong>Investor access requests</strong>
            <button type="button" onClick={markAllRead} disabled={loading || unreadCount === 0}>
              {loading ? <LoaderCircle className="spin" size={13} /> : "Mark all read"}
            </button>
          </div>
          {items.length === 0 ? (
            <p className="notification-bell-empty">Nothing to review right now.</p>
          ) : (
            <ul>
              {items.map((item) => (
                <li key={item.id} className={item.readAt ? "read" : "unread"}>
                  <Link href="/backoffice/investors" onClick={() => markRead(item.id)}>
                    <strong>{item.title}</strong>
                    <span>{item.body}</span>
                    <small>{new Date(item.createdAt).toLocaleString()}</small>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link href="/backoffice/investors" className="notification-bell-footer" onClick={() => setOpen(false)}>
            Review all requests
          </Link>
        </div>
      ) : null}
    </div>
  );
}
