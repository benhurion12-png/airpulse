"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { API_URL, api } from "@/lib/api";
import { Dashboard as DashboardType, HistoryPoint, Location, SensorType, User, UserRole } from "@/lib/types";
import { Icon, IconName } from "./icons";
import { CoordinatePicker } from "./coordinate-picker";
import { QualityChart } from "./quality-chart";
import { RegionMap } from "./region-map";

type View = "overview" | "objects" | "sensors" | "forecast";
type Modal = "sensor" | "location" | "details" | "notifications" | "settings" | "profile" | "users" | null;
type Theme = "light" | "dark";
type AppSettings = {
  theme: Theme;
  refreshSeconds: number;
  alertThreshold: number;
  qualityAlerts: boolean;
  sensorAlerts: boolean;
};
type AlertNotification = {
  id: string;
  tone: "danger" | "warning" | "info";
  icon: IconName;
  title: string;
  description: string;
  locationId?: string;
};

const SETTINGS_KEY = "airpulse-settings";
const READ_NOTIFICATIONS_KEY = "airpulse-read-notifications";
const DEFAULT_SETTINGS: AppSettings = {
  theme: "light",
  refreshSeconds: 15,
  alertThreshold: 65,
  qualityAlerts: true,
  sensorAlerts: true,
};

const sensorTypes: SensorType[] = ["CH4", "NO2", "PM2.5", "SO2", "PM10", "CO", "CO2", "MQ2"];
const nav: { id: View; label: string; icon: IconName }[] = [
  { id: "overview", label: "Обзор", icon: "grid" },
  { id: "objects", label: "Объекты", icon: "pin" },
  { id: "sensors", label: "Датчики", icon: "sensor" },
  { id: "forecast", label: "ML-прогноз", icon: "chart" },
];

function scoreTone(score: number | null) {
  if (score === null) return "neutral";
  if (score >= 85) return "good";
  if (score >= 65) return "blue";
  if (score >= 40) return "warning";
  return "danger";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Almaty" }).format(new Date(value));
}

function buildNotifications(data: DashboardType, settings: AppSettings): AlertNotification[] {
  const result: AlertNotification[] = [];
  if (settings.qualityAlerts) {
    data.locations.forEach((location) => {
      if (location.score === null) {
        result.push({ id: `location-no-data:${location.id}`, tone: "warning", icon: "pin", title: `${location.name}: нет данных`, description: "На объекте нет показаний, из которых можно рассчитать индекс качества.", locationId: location.id });
      } else if (location.score < settings.alertThreshold) {
        result.push({ id: `location-quality:${location.id}`, tone: location.score < 40 ? "danger" : "warning", icon: "pin", title: `${location.name}: индекс ${Math.round(location.score)}`, description: `Качество ниже заданного порога ${settings.alertThreshold}. Проверьте показания датчиков.`, locationId: location.id });
      }
    });
  }
  if (settings.sensorAlerts) {
    data.locations.forEach((location) => location.sensors.forEach((sensor) => {
      if (!sensor.online) {
        result.push({ id: `sensor-offline:${sensor.id}`, tone: sensor.mode === "REAL" ? "danger" : "info", icon: "sensor", title: `${sensor.name}: нет связи`, description: `${location.name} · ${sensor.lastSeen ? `последняя связь ${formatDate(sensor.lastSeen)}` : "данные ещё не поступали"}.`, locationId: location.id });
      }
    }));
  }
  return result;
}

const roleLabels: Record<UserRole, string> = { CLIENT: "Клиент", OPERATOR: "Оператор", ADMIN: "Администратор" };

function userInitials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "AP";
}

function ScoreRing({ score, compact = false }: { score: number | null; compact?: boolean }) {
  const value = score ?? 0;
  return (
    <div className={`score-ring ${scoreTone(score)}${compact ? " compact" : ""}`} style={{ "--score": value } as React.CSSProperties}>
      <div><strong>{score === null ? "—" : Math.round(score)}</strong>{!compact && <span>из 100</span>}</div>
    </div>
  );
}

function StatusPill({ score, label }: { score: number | null; label?: string }) {
  return <span className={`status-pill ${scoreTone(score)}`}><i />{label || (score === null ? "Нет данных" : score >= 85 ? "Чисто" : score >= 65 ? "Умеренно" : score >= 40 ? "Повышено" : "Опасно")}</span>;
}

export function Dashboard() {
  const [user, setUser] = useState<User>();
  const [authLoading, setAuthLoading] = useState(true);
  const [managedUsers, setManagedUsers] = useState<User[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [data, setData] = useState<DashboardType | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [view, setView] = useState<View>("overview");
  const [modal, setModal] = useState<Modal>(null);
  const [theme, setTheme] = useState<Theme>("light");
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [settingsDraft, setSettingsDraft] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [readNotificationIds, setReadNotificationIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [search, setSearch] = useState("");
  const [sensorType, setSensorType] = useState<SensorType>("PM2.5");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [locationCoordinates, setLocationCoordinates] = useState({ latitude: 54.8665, longitude: 69.1334 });

  const refresh = useCallback(async () => {
    try {
      const next = await api.dashboard();
      setData(next);
      setSelectedId((current) => current && next.locations.some((location) => location.id === current) ? current : next.locations[0]?.id);
      setError(undefined);
    } catch (caught) {
      if (!api.hasSession()) {
        setUser(undefined);
        setData(null);
      }
      setError(caught instanceof Error ? caught.message : "Не удалось получить данные");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const systemTheme: Theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    const legacyTheme = localStorage.getItem("airpulse-theme");
    let nextSettings = { ...DEFAULT_SETTINGS, theme: legacyTheme === "dark" || legacyTheme === "light" ? legacyTheme : systemTheme };
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null") as Partial<AppSettings> | null;
      if (saved) {
        nextSettings = {
          theme: saved.theme === "dark" || saved.theme === "light" ? saved.theme : nextSettings.theme,
          refreshSeconds: [10, 15, 30, 60].includes(Number(saved.refreshSeconds)) ? Number(saved.refreshSeconds) : DEFAULT_SETTINGS.refreshSeconds,
          alertThreshold: Number.isFinite(Number(saved.alertThreshold)) ? Math.min(100, Math.max(0, Number(saved.alertThreshold))) : DEFAULT_SETTINGS.alertThreshold,
          qualityAlerts: saved.qualityAlerts !== false,
          sensorAlerts: saved.sensorAlerts !== false,
        };
      }
    } catch {}
    setSettings(nextSettings);
    setSettingsDraft(nextSettings);
    setTheme(nextSettings.theme);
    document.documentElement.dataset.theme = nextSettings.theme;
    try {
      const savedReadIds = JSON.parse(localStorage.getItem(READ_NOTIFICATIONS_KEY) || "[]");
      if (Array.isArray(savedReadIds)) setReadNotificationIds(savedReadIds.filter((item): item is string => typeof item === "string"));
    } catch {}
    const restoreSession = async () => {
      if (!api.hasSession()) {
        setLoading(false);
        setAuthLoading(false);
        return;
      }
      try {
        const current = await api.me();
        setUser(current);
        await refresh();
      } catch {
        api.logout();
        setLoading(false);
      } finally {
        setAuthLoading(false);
      }
    };
    void restoreSession();
  }, [refresh]);

  useEffect(() => {
    if (!user) return;
    const timer = window.setInterval(refresh, settings.refreshSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [refresh, settings.refreshSeconds, user]);

  useEffect(() => {
    if (!modal) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setModal(null); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [modal]);

  useEffect(() => {
    if (!selectedId || !user) return;
    api.history(selectedId).then((result) => setHistory(result.points)).catch(() => setHistory([]));
  }, [selectedId, data?.updatedAt, user]);

  const selected = useMemo(() => data?.locations.find((location) => location.id === selectedId) || data?.locations[0], [data, selectedId]);
  const allSensors = useMemo(() => data?.locations.flatMap((location) => location.sensors.map((sensor) => ({ ...sensor, location }))) || [], [data]);
  const notifications = useMemo(() => data ? buildNotifications(data, settings) : [], [data, settings]);
  const unreadNotifications = notifications.filter((item) => !readNotificationIds.includes(item.id));
  const filteredSensors = allSensors.filter((sensor) => `${sensor.name} ${sensor.type} ${sensor.id} ${sensor.location.name}`.toLowerCase().includes(search.toLowerCase()));
  const canManage = user?.role === "OPERATOR" || user?.role === "ADMIN";
  const setSelected = useCallback((id: string) => setSelectedId(id), []);

  useEffect(() => {
    if (!data) return;
    const activeIds = new Set(notifications.map((item) => item.id));
    setReadNotificationIds((current) => {
      const next = current.filter((id) => activeIds.has(id));
      if (next.length === current.length && next.every((id, index) => id === current[index])) return current;
      localStorage.setItem(READ_NOTIFICATIONS_KEY, JSON.stringify(next));
      return next;
    });
  }, [data, notifications]);

  function applySettings(next: AppSettings) {
    setSettings(next);
    setSettingsDraft(next);
    setTheme(next.theme);
    document.documentElement.dataset.theme = next.theme;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    localStorage.setItem("airpulse-theme", next.theme);
  }

  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    applySettings({ ...settings, theme: next });
  }

  function openSettings() {
    setSettingsDraft(settings);
    setModal("settings");
  }

  function markAllNotificationsRead() {
    const ids = notifications.map((item) => item.id);
    setReadNotificationIds(ids);
    localStorage.setItem(READ_NOTIFICATIONS_KEY, JSON.stringify(ids));
  }

  function openNotification(item: AlertNotification) {
    const ids = readNotificationIds.includes(item.id) ? readNotificationIds : [...readNotificationIds, item.id];
    setReadNotificationIds(ids);
    localStorage.setItem(READ_NOTIFICATIONS_KEY, JSON.stringify(ids));
    if (item.locationId) {
      setSelectedId(item.locationId);
      setView("overview");
    }
    setModal(null);
  }

  function submitSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    applySettings(settingsDraft);
    setModal(null);
    setNotice("Настройки сохранены в этом браузере");
  }

  async function handleAuthenticated(nextUser: User) {
    setUser(nextUser);
    setError(undefined);
    setLoading(true);
    await refresh();
  }

  function logout() {
    api.logout();
    setUser(undefined);
    setData(null);
    setHistory([]);
    setSelectedId(undefined);
    setModal(null);
    setError(undefined);
    setLoading(false);
  }

  async function openUsers() {
    setModal("users");
    setUsersLoading(true);
    try {
      setManagedUsers(await api.users());
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Не удалось получить пользователей");
      setModal(null);
    } finally {
      setUsersLoading(false);
    }
  }

  async function changeUserRole(userId: string, role: UserRole) {
    try {
      const updated = await api.updateUserRole(userId, role);
      setManagedUsers((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Не удалось изменить роль");
    }
  }

  async function changeUserActive(userId: string, isActive: boolean) {
    try {
      const updated = await api.updateUserActive(userId, isActive);
      setManagedUsers((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Не удалось изменить доступ");
    }
  }

  async function submitSensor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api.addSensor(Object.fromEntries(form.entries()) as Record<string, string>);
      setModal(null);
      setNotice("Датчик добавлен и готов к приёму телеметрии");
      await refresh();
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Не удалось добавить датчик");
    }
  }

  async function submitLocation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const raw = Object.fromEntries(form.entries()) as Record<string, string>;
    try {
      await api.addLocation({ ...raw, latitude: Number(raw.latitude), longitude: Number(raw.longitude) });
      setModal(null);
      setPickerOpen(false);
      setNotice("Новый объект добавлен на карту СКО");
      await refresh();
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Не удалось добавить объект");
    }
  }

  if (authLoading) return <div className="boot-screen"><Image src="/logo.svg" width={72} height={72} alt="AirPulse" priority/><div className="loader"/><p>Проверяем сессию…</p></div>;

  if (!user) return <AuthScreen onAuthenticated={handleAuthenticated}/>;

  if (loading) return <div className="boot-screen"><Image src="/logo.svg" width={72} height={72} alt="AirPulse" priority/><div className="loader"/><p>Подключаем сеть мониторинга…</p></div>;

  if (!data || error) return (
    <div className="boot-screen error-screen"><Image src="/logo.svg" width={72} height={72} alt="AirPulse"/><h1>AirPulse API недоступен</h1><p>{error || "Запустите backend на порту 8000"}</p><button className="primary-button" onClick={refresh}>Повторить</button></div>
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setView("overview")}><Image src="/logo.svg" width={42} height={42} alt="" priority/><span>Air<span>Pulse</span></span></button>
        <nav>
          <span className="nav-caption">Мониторинг</span>
          {nav.map((item) => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}><Icon name={item.icon}/><span>{item.label}</span>{item.id === "sensors" && <b>{data.totalSensors}</b>}</button>)}
          <span className="nav-caption lower">Система</span>
          <button className={modal === "notifications" ? "active" : ""} onClick={() => setModal("notifications")}><Icon name="bell"/><span>Уведомления</span>{unreadNotifications.length > 0 && <em>{unreadNotifications.length > 99 ? "99+" : unreadNotifications.length}</em>}</button>
          <button className={modal === "settings" ? "active" : ""} onClick={openSettings}><Icon name="settings"/><span>Настройки</span></button>
        </nav>
        <div className="system-card">
          <div className="system-icon"><Icon name="pulse"/></div>
          <div><strong>{data.onlineSensors === data.totalSensors ? "Система работает" : "Нужен контроль"}</strong><span>{data.onlineSensors} из {data.totalSensors} датчиков онлайн</span></div>
        </div>
        <button className="profile" onClick={() => setModal("profile")}><div className="avatar">{userInitials(user.name)}</div><div><strong>{user.name}</strong><span>{roleLabels[user.role]}</span></div><Icon name="arrow"/></button>
      </aside>

      <main>
        <header className="topbar">
          <div><p>Северо-Казахстанская область</p><h1>{view === "overview" ? "Обзор качества воздуха" : view === "objects" ? "Объекты мониторинга" : view === "sensors" ? "Сеть датчиков" : "Прогноз состояния воздуха"}</h1></div>
          <div className="top-actions">
            <span className="updated"><i/>Обновлено {formatDate(data.updatedAt)}</span>
            <button className="icon-button theme-toggle" onClick={toggleTheme} title="Переключить тему" aria-label="Переключить тему"><Icon name={theme === "light" ? "moon" : "sun"}/></button>
            <button className="icon-button notification" onClick={() => setModal("notifications")} title="Уведомления" aria-label={`Уведомления: ${unreadNotifications.length} непрочитанных`}><Icon name="bell"/>{unreadNotifications.length > 0 && <span>{unreadNotifications.length > 9 ? "9+" : unreadNotifications.length}</span>}</button>
            <button className="icon-button settings-trigger" onClick={openSettings} title="Настройки" aria-label="Открыть настройки"><Icon name="settings"/></button>
            <button className="icon-button account-trigger" onClick={() => setModal("profile")} title="Профиль" aria-label="Открыть профиль">{userInitials(user.name)}</button>
            {canManage && <button className="primary-button" onClick={() => setModal(view === "objects" ? "location" : "sensor")}><Icon name="plus"/>{view === "objects" ? "Добавить объект" : "Добавить датчик"}</button>}
          </div>
        </header>

        {notice && <button className="notice" onClick={() => setNotice(undefined)}>{notice}<span>×</span></button>}

        {view === "overview" && selected && <Overview data={data} selected={selected} history={history} onSelect={setSelected} onOpen={() => setModal("details")}/>} 
        {view === "objects" && <ObjectsView locations={data.locations} onAdd={canManage ? () => setModal("location") : undefined} onSelect={(id) => { setSelectedId(id); setView("overview"); }}/>} 
        {view === "sensors" && <SensorsView sensors={filteredSensors} search={search} onSearch={setSearch} onAdd={canManage ? () => setModal("sensor") : undefined} />} 
        {view === "forecast" && <ForecastView locations={data.locations} />} 
      </main>

      {modal === "sensor" && <div className="modal-backdrop" onMouseDown={() => setModal(null)}><div className="modal" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={() => setModal(null)}>×</button>
        <span className="eyebrow">Администрирование</span><h2>Новый датчик</h2><p>Зарегистрируйте сенсор и сразу привяжите его к объекту.</p>
        <form onSubmit={submitSensor}>
          <label>ID устройства<input name="id" required pattern="[A-Za-z0-9_-]{3,64}" placeholder="mq2-real-001"/></label>
          <label>Название<input name="name" required placeholder="MQ-2 · котельная"/></label>
          <div className="form-row"><label>Тип<select name="type" value={sensorType} onChange={(event) => setSensorType(event.target.value as SensorType)}>{sensorTypes.map((type) => <option key={type}>{type}</option>)}</select></label><label>Режим<select name="mode" disabled={sensorType !== "MQ2"}><option value="SIMULATED">Симуляция</option>{sensorType === "MQ2" && <option value="REAL">Реальный</option>}</select></label></div>
          <label>Объект<select name="location_id" required>{data.locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
          {sensorType === "MQ2" && <div className="form-hint"><Icon name="pulse"/><span><b>Реальный режим</b> принимает MQTT‑данные от ESP32. Симулятор этот датчик пропустит.</span></div>}
          <button className="primary-button wide" type="submit">Добавить датчик</button>
        </form>
      </div></div>}

      {modal === "location" && <div className="modal-backdrop" onMouseDown={() => { setModal(null); setPickerOpen(false); }}><div className={`modal ${pickerOpen ? "location-modal-wide" : ""}`} onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={() => { setModal(null); setPickerOpen(false); }}>×</button>
        <span className="eyebrow">Только территория СКО</span><h2>Новый объект</h2><p>Координаты проверяются по границам Северо‑Казахстанской области.</p>
        <form onSubmit={submitLocation}>
          <label>Название<input name="name" required placeholder="Производственная площадка"/></label>
          <div className="form-row"><label>Населённый пункт<input name="city" required placeholder="Петропавловск"/></label><label>Адрес<input name="address" placeholder="ул. Промышленная, 1"/></label></div>
          <div className="coordinates-label"><span>Координаты объекта</span><button type="button" onClick={() => setPickerOpen((open) => !open)}><Icon name="pin"/>{pickerOpen ? "Скрыть карту" : "Выбрать на карте"}</button></div>
          {pickerOpen && <CoordinatePicker value={locationCoordinates} onChange={setLocationCoordinates} onDone={() => setPickerOpen(false)} />}
          <div className="form-row"><label>Широта<input name="latitude" required type="number" step="0.00001" min="52.7" max="56" value={locationCoordinates.latitude} onChange={(event) => setLocationCoordinates((current) => ({ ...current, latitude: Number(event.target.value) }))}/></label><label>Долгота<input name="longitude" required type="number" step="0.00001" min="65.5" max="72.5" value={locationCoordinates.longitude} onChange={(event) => setLocationCoordinates((current) => ({ ...current, longitude: Number(event.target.value) }))}/></label></div>
          <button className="primary-button wide" type="submit">Добавить на карту</button>
        </form>
      </div></div>}

      {modal === "details" && selected && <div className="modal-backdrop" onMouseDown={() => setModal(null)}><div className="modal object-details-modal" role="dialog" aria-modal="true" aria-labelledby="object-details-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={() => setModal(null)} aria-label="Закрыть карточку объекта">×</button>
        <span className="eyebrow">Карточка объекта</span>
        <div className="object-details-head"><div><h2 id="object-details-title">{selected.name}</h2><p className="location-address"><Icon name="pin"/>{selected.city}{selected.address ? ` · ${selected.address}` : ""}</p></div><ScoreRing score={selected.score}/></div>
        <div className="object-details-summary"><div><span>Статус</span><StatusPill score={selected.score} label={selected.status}/></div><div><span>Датчики</span><strong>{selected.sensors.length}</strong></div><div><span>Онлайн</span><strong>{selected.sensors.filter((sensor) => sensor.online).length}</strong></div><div><span>Координаты</span><strong>{selected.latitude.toFixed(4)}, {selected.longitude.toFixed(4)}</strong></div></div>
        <div className="sensor-list object-details-sensors">
          {selected.sensors.map((sensor) => <div className="sensor-row" key={sensor.id}><div className={`sensor-badge ${scoreTone(sensor.quality)}`}>{sensor.type}</div><div><strong>{sensor.value ?? "—"} <small>{sensor.unit}</small></strong><span>{sensor.name} · {sensor.mode === "REAL" ? "Реальный" : "Симуляция"}</span></div><StatusPill score={sensor.quality}/></div>)}
          {!selected.sensors.length && <div className="empty-small">На объекте пока нет датчиков</div>}
        </div>
      </div></div>}

      {modal === "notifications" && <div className="modal-backdrop" onMouseDown={() => setModal(null)}><div className="modal notifications-modal" role="dialog" aria-modal="true" aria-labelledby="notifications-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={() => setModal(null)} aria-label="Закрыть уведомления">×</button>
        <span className="eyebrow">Состояние системы</span><h2 id="notifications-title">Уведомления</h2><p>Список строится автоматически по текущим показаниям и заданному порогу.</p>
        <div className="notifications-toolbar"><span>{unreadNotifications.length ? `${unreadNotifications.length} непрочитанных` : "Всё прочитано"}</span>{unreadNotifications.length > 0 && <button type="button" onClick={markAllNotificationsRead}>Прочитать все</button>}</div>
        <div className="notifications-list">
          {notifications.map((item) => <button className={`notification-item ${item.tone}${readNotificationIds.includes(item.id) ? " read" : ""}`} key={item.id} onClick={() => openNotification(item)}><i><Icon name={item.icon}/></i><span><strong>{item.title}</strong><small>{item.description}</small></span>{!readNotificationIds.includes(item.id) && <b aria-label="Непрочитано"/>}</button>)}
          {!notifications.length && <div className="notifications-empty"><Icon name="bell"/><strong>Новых событий нет</strong><span>Все объекты и датчики находятся в пределах выбранных правил.</span></div>}
        </div>
      </div></div>}

      {modal === "settings" && <div className="modal-backdrop" onMouseDown={() => setModal(null)}><div className="modal settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={() => setModal(null)} aria-label="Закрыть настройки">×</button>
        <span className="eyebrow">Параметры интерфейса</span><h2 id="settings-title">Настройки</h2><p>Значения сохраняются только в этом браузере и не меняют конфигурацию Docker.</p>
        <form className="settings-form" onSubmit={submitSettings}>
          <div className="settings-grid"><label>Тема<select value={settingsDraft.theme} onChange={(event) => setSettingsDraft((current) => ({ ...current, theme: event.target.value as Theme }))}><option value="light">Светлая</option><option value="dark">Тёмная</option></select></label><label>Обновлять данные<select value={settingsDraft.refreshSeconds} onChange={(event) => setSettingsDraft((current) => ({ ...current, refreshSeconds: Number(event.target.value) }))}><option value={10}>каждые 10 секунд</option><option value={15}>каждые 15 секунд</option><option value={30}>каждые 30 секунд</option><option value={60}>каждую минуту</option></select></label></div>
          <label>Порог тревоги для индекса<input type="number" min="0" max="100" value={settingsDraft.alertThreshold} onChange={(event) => setSettingsDraft((current) => ({ ...current, alertThreshold: Math.min(100, Math.max(0, Number(event.target.value))) }))}/><small>Уведомление появится, когда оценка объекта станет ниже этого числа.</small></label>
          <div className="settings-switches"><label><span><b>Качество воздуха</b><small>Сообщать о низком индексе и отсутствии данных.</small></span><input type="checkbox" checked={settingsDraft.qualityAlerts} onChange={(event) => setSettingsDraft((current) => ({ ...current, qualityAlerts: event.target.checked }))}/><i/></label><label><span><b>Связь с датчиками</b><small>Сообщать о датчиках, которые перестали выходить в сеть.</small></span><input type="checkbox" checked={settingsDraft.sensorAlerts} onChange={(event) => setSettingsDraft((current) => ({ ...current, sensorAlerts: event.target.checked }))}/><i/></label></div>
          <div className="settings-connection"><Icon name="pulse"/><span><small>Адрес API</small><b>{API_URL}</b></span></div>
          <div className="settings-actions"><button className="secondary-button" type="button" onClick={() => setSettingsDraft(DEFAULT_SETTINGS)}>По умолчанию</button><button className="primary-button" type="submit">Сохранить</button></div>
        </form>
      </div></div>}

      {modal === "profile" && <div className="modal-backdrop" onMouseDown={() => setModal(null)}><div className="modal profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={() => setModal(null)} aria-label="Закрыть профиль">×</button>
        <div className="profile-modal-head"><div className="profile-avatar">{userInitials(user.name)}</div><div><span className="eyebrow">Учётная запись</span><h2 id="profile-title">{user.name}</h2><span className={`role-badge ${user.role.toLowerCase()}`}>{roleLabels[user.role]}</span></div></div>
        <div className="profile-info"><div><span>Email</span><strong>{user.email}</strong></div><div><span>Дата регистрации</span><strong>{formatDate(user.createdAt)}</strong></div></div>
        <p className="profile-hint">{user.role === "CLIENT" ? "Клиент может просматривать объекты, датчики, прогнозы и уведомления." : user.role === "OPERATOR" ? "Оператор может добавлять объекты и датчики, но не управляет пользователями." : "Администратор имеет полный доступ, включая роли и блокировку пользователей."}</p>
        <div className="profile-actions">{user.role === "ADMIN" && <button className="secondary-button" onClick={openUsers}>Управление пользователями</button>}<button className="logout-button" onClick={logout}>Выйти из аккаунта</button></div>
      </div></div>}

      {modal === "users" && <div className="modal-backdrop" onMouseDown={() => setModal(null)}><div className="modal users-modal" role="dialog" aria-modal="true" aria-labelledby="users-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={() => setModal(null)} aria-label="Закрыть пользователей">×</button>
        <span className="eyebrow">Только администратор</span><h2 id="users-title">Пользователи</h2><p>Новые регистрации получают роль «Клиент». Здесь можно выдать права оператора или администратора.</p>
        <div className="users-list">
          {usersLoading && <div className="users-loading"><div className="loader"/>Загружаем пользователей…</div>}
          {!usersLoading && managedUsers.map((item) => <div className={`user-row${item.isActive ? "" : " disabled"}`} key={item.id}><div className="user-avatar">{userInitials(item.name)}</div><div className="user-identity"><strong>{item.name}{item.id === user.id && <small>вы</small>}</strong><span>{item.email}</span></div><select aria-label={`Роль пользователя ${item.name}`} value={item.role} disabled={item.id === user.id} onChange={(event) => changeUserRole(item.id, event.target.value as UserRole)}><option value="CLIENT">Клиент</option><option value="OPERATOR">Оператор</option><option value="ADMIN">Администратор</option></select><button className={`user-state ${item.isActive ? "active" : ""}`} disabled={item.id === user.id} onClick={() => changeUserActive(item.id, !item.isActive)}>{item.isActive ? "Активен" : "Отключён"}</button></div>)}
        </div>
      </div></div>}
    </div>
  );
}

function AuthScreen({ onAuthenticated }: { onAuthenticated: (user: User) => Promise<void> }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") || "");
    if (mode === "register" && password !== String(form.get("confirmPassword") || "")) {
      setError("Пароли не совпадают");
      return;
    }
    setPending(true);
    setError(undefined);
    try {
      const session = mode === "login"
        ? await api.login({ email: String(form.get("email") || ""), password })
        : await api.register({ name: String(form.get("name") || ""), email: String(form.get("email") || ""), password });
      await onAuthenticated(session.user);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось войти");
    } finally {
      setPending(false);
    }
  }

  function switchMode(next: "login" | "register") {
    setMode(next);
    setError(undefined);
  }

  return <div className="auth-screen">
    <section className="auth-about"><Image src="/logo.svg" width={66} height={66} alt="AirPulse" priority/><span className="auth-brand">Air<span>Pulse</span></span><h1>Чистый воздух начинается с точных данных</h1><p>Единая система объектов, датчиков, карты, уведомлений и прогноза качества воздуха Северо‑Казахстанской области.</p><div className="auth-features"><span><Icon name="pin"/>Объекты на живой карте</span><span><Icon name="sensor"/>Реальные и виртуальные датчики</span><span><Icon name="chart"/>ML‑прогноз на 60 минут</span></div></section>
    <section className="auth-panel"><div className="auth-card"><div className="auth-tabs"><button className={mode === "login" ? "active" : ""} onClick={() => switchMode("login")}>Вход</button><button className={mode === "register" ? "active" : ""} onClick={() => switchMode("register")}>Регистрация</button></div><span className="eyebrow">AirPulse Account</span><h2>{mode === "login" ? "Добро пожаловать" : "Создать аккаунт"}</h2><p>{mode === "login" ? "Введите данные своей учётной записи." : "Новый пользователь получает роль «Клиент» и доступ к просмотру мониторинга."}</p>
      <form onSubmit={submit}>
        {mode === "register" && <label>Имя и фамилия<input name="name" required minLength={2} maxLength={120} autoComplete="name" placeholder="Ксения Иванова"/></label>}
        <label>Email<input name="email" required type="email" autoComplete="email" placeholder="name@example.com"/></label>
        <label>Пароль<input name="password" required type="password" minLength={8} maxLength={128} autoComplete={mode === "login" ? "current-password" : "new-password"} placeholder="Минимум 8 символов"/></label>
        {mode === "register" && <label>Повторите пароль<input name="confirmPassword" required type="password" minLength={8} maxLength={128} autoComplete="new-password" placeholder="Введите пароль ещё раз"/></label>}
        {error && <div className="auth-error">{error}</div>}
        <button className="primary-button wide" type="submit" disabled={pending}>{pending ? "Подождите…" : mode === "login" ? "Войти" : "Зарегистрироваться"}</button>
      </form>
      <small className="auth-note">Пароль должен содержать минимум одну букву и одну цифру.</small>
    </div></section>
  </div>;
}

function Overview({ data, selected, history, onSelect, onOpen }: { data: DashboardType; selected: Location; history: HistoryPoint[]; onSelect: (id: string) => void; onOpen: () => void }) {
  const projected = selected.forecast?.score ?? selected.score;
  const delta = selected.score !== null && projected !== null ? Math.round((projected - selected.score) * 10) / 10 : 0;
  return <div className="view-content">
    <section className="hero-grid">
      <article className="card quality-card">
        <div className="card-head"><div><span className="eyebrow">Индекс AirPulse</span><h2>Общее качество</h2></div><StatusPill score={data.overallScore}/></div>
        <div className="quality-main"><ScoreRing score={data.overallScore}/><div><strong>{data.overallScore !== null && data.overallScore >= 70 ? "Воздух в норме" : "Нужен контроль"}</strong><p>Средняя оценка по {data.locations.length} объектам области</p><span className="delta positive">↑ 3.2% за 24 часа</span></div></div>
      </article>
      <article className="card metric-card"><div className="metric-icon cyan"><Icon name="sensor"/></div><div><span>Датчики онлайн</span><strong>{data.onlineSensors}<small> / {data.totalSensors}</small></strong><p>{data.totalSensors ? Math.round(data.onlineSensors / data.totalSensors * 100) : 0}% сети передаёт данные</p></div><div className="mini-bars">{[45,62,54,76,68,88,81,93,86,96].map((height, i) => <i key={i} style={{ height: `${height}%` }}/>)}</div></article>
      <article className="card metric-card"><div className="metric-icon violet"><Icon name="pin"/></div><div><span>Объекты</span><strong>{data.locations.length}</strong><p>{data.locations.filter((item) => (item.score ?? 0) < 65).length} требуют внимания</p></div><div className="donut-small"><strong>{data.locations.filter((item) => (item.score ?? 0) >= 65).length}</strong><span>стабильно</span></div></article>
    </section>

    <section className="dashboard-grid">
      <article className="card map-card">
        <div className="card-head"><div><span className="eyebrow">Живая сеть</span><h2>Карта объектов СКО</h2></div><span className="map-legend"><i/> качество 0–100</span></div>
        <div className="map-body"><RegionMap locations={data.locations} selectedId={selected.id} onSelect={onSelect}/><div className="map-overlay"><span>Северо-Казахстанская область</span><strong>{data.locations.length} объектов</strong></div></div>
      </article>
      <article className="card location-card">
        <div className="card-head"><div><span className="eyebrow">Выбранный объект</span><h2>{selected.name}</h2></div><ScoreRing score={selected.score} compact/></div>
        <p className="location-address"><Icon name="pin"/>{selected.city}{selected.address ? ` · ${selected.address}` : ""}</p>
        <div className="sensor-list">
          {selected.sensors.map((sensor) => <div className="sensor-row" key={sensor.id}><div className={`sensor-badge ${scoreTone(sensor.quality)}`}>{sensor.type}</div><div><strong>{sensor.value ?? "—"} <small>{sensor.unit}</small></strong><span>{sensor.mode === "REAL" ? "Реальный · ESP32" : "Симуляция"}</span></div><StatusPill score={sensor.quality}/></div>)}
          {!selected.sensors.length && <div className="empty-small">На объекте пока нет датчиков</div>}
        </div>
        <button className="text-button" onClick={onOpen}>Открыть карточку объекта <Icon name="arrow"/></button>
      </article>
    </section>

    <section className="dashboard-grid lower-grid">
      <article className="card chart-card"><div className="card-head"><div><span className="eyebrow">Последние 24 часа</span><h2>Динамика качества воздуха</h2></div><div className="chart-value"><strong>{selected.score ?? "—"}</strong><span>сейчас</span></div></div><QualityChart points={history}/></article>
      <article className="card forecast-card"><div className="card-head"><div><span className="eyebrow">Линейная регрессия · 60 мин</span><h2>ML-прогноз</h2></div><span className="confidence">{selected.forecast?.confidence ?? 0}% точность</span></div><div className="forecast-score"><div><span>Ожидаемый индекс</span><strong>{projected === null ? "—" : Math.round(projected)}</strong></div><span className={`delta ${delta >= 0 ? "positive" : "negative"}`}>{delta >= 0 ? "↑" : "↓"} {Math.abs(delta)} пункта</span></div><div className="forecast-track"><i style={{ width: `${projected ?? 0}%` }}/><b style={{ left: `${selected.score ?? 0}%` }}/></div><p>Модель анализирует историю всех установленных параметров объекта и прогнозирует их концентрации отдельно.</p></article>
    </section>
  </div>;
}

function ObjectsView({ locations, onAdd, onSelect }: { locations: Location[]; onAdd?: () => void; onSelect: (id: string) => void }) {
  return <div className="view-content"><div className="section-intro"><div><span className="eyebrow">{locations.length} точек в регионе</span><h2>Контролируемые объекты</h2><p>Все локации ограничены территорией Северо‑Казахстанской области.</p></div>{onAdd && <button className="secondary-button" onClick={onAdd}><Icon name="plus"/>Новый объект</button>}</div><div className="objects-grid">{locations.map((location) => <button className="card object-card" key={location.id} onClick={() => onSelect(location.id)}><div className="object-top"><div className={`object-pin ${scoreTone(location.score)}`}><Icon name="pin"/></div><StatusPill score={location.score} label={location.status}/></div><h3>{location.name}</h3><p>{location.city} · {location.address || "Адрес не указан"}</p><div className="object-bottom"><ScoreRing score={location.score} compact/><div><strong>{location.sensors.length}</strong><span>датчиков</span></div><div><strong>{location.sensors.filter((sensor) => sensor.online).length}</strong><span>онлайн</span></div><Icon name="arrow"/></div></button>)}</div></div>;
}

function SensorsView({ sensors, search, onSearch, onAdd }: { sensors: ReturnType<typeof enrichSensor>[]; search: string; onSearch: (value: string) => void; onAdd?: () => void }) {
  return <div className="view-content"><div className="toolbar"><label className="search"><Icon name="search"/><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Найти датчик, тип или объект"/></label><div className="toolbar-count">Показано: <b>{sensors.length}</b></div>{onAdd && <button className="secondary-button" onClick={onAdd}><Icon name="plus"/>Добавить</button>}</div><div className="card table-card"><div className="sensor-table table-head"><span>Датчик</span><span>Объект</span><span>Значение</span><span>Режим</span><span>Статус</span></div>{sensors.map((sensor) => <div className="sensor-table" key={sensor.id}><span className="sensor-name"><i className={scoreTone(sensor.quality)}><Icon name="sensor"/></i><span><b>{sensor.name}</b><small>{sensor.id}</small></span></span><span><b>{sensor.location.name}</b><small>{sensor.location.city}</small></span><span className="reading"><b>{sensor.value ?? "—"}</b><small>{sensor.unit}</small></span><span><em className={sensor.mode === "REAL" ? "real" : "sim"}>{sensor.mode === "REAL" ? "Реальный" : "Симуляция"}</em></span><span><span className={`online ${sensor.online ? "" : "off"}`}><i/>{sensor.online ? "Онлайн" : "Нет связи"}</span></span></div>)}</div></div>;
}

function enrichSensor() { return {} as Location["sensors"][number] & { location: Location }; }

function ForecastView({ locations }: { locations: Location[] }) {
  return <div className="view-content"><article className="ml-hero"><div><span className="eyebrow">AIRPULSE INTELLIGENCE</span><h2>Прогноз на основе истории каждого объекта</h2><p>Модель линейной регрессии строит тренд отдельно для CH₄, NO₂, PM2.5, SO₂, PM10, CO, CO₂ и MQ‑2. Затем прогнозные концентрации объединяются в индекс 0–100.</p></div><div className="ml-orbit"><Icon name="pulse"/><i/><i/><i/></div></article><div className="forecast-list">{locations.map((location) => { const forecast = location.forecast; const score = forecast?.score ?? null; const delta = score !== null && location.score !== null ? score - location.score : 0; return <article className="card forecast-row-card" key={location.id}><div className="forecast-location"><ScoreRing score={score} compact/><div><h3>{location.name}</h3><p>{location.city} · прогноз через 60 минут</p></div></div><div className="forecast-metrics"><div><span>Сейчас</span><strong>{location.score ?? "—"}</strong></div><Icon name="arrow"/><div><span>Прогноз</span><strong>{score === null ? "—" : Math.round(score)}</strong></div><span className={`delta ${delta >= 0 ? "positive" : "negative"}`}>{delta >= 0 ? "+" : ""}{delta.toFixed(1)}</span></div><div className="model-info"><span><i style={{ width: `${forecast?.confidence ?? 0}%` }}/></span><b>{forecast?.confidence ?? 0}%</b><small>уверенность</small></div></article>; })}</div><article className="card methodology"><span className="eyebrow">Как это работает</span><div><div><b>01</b><h3>48 часов истории</h3><p>Берутся измерения всех сенсоров конкретного объекта.</p></div><div><b>02</b><h3>Регрессия по параметрам</h3><p>Для каждого загрязнителя оцениваются наклон тренда и R².</p></div><div><b>03</b><h3>Общий индекс</h3><p>Прогнозные значения пересчитываются в оценку воздуха 0–100.</p></div></div></article></div>;
}

