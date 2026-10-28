export type SensorType = "CH4" | "NO2" | "PM2.5" | "SO2" | "PM10" | "CO" | "CO2" | "MQ2";
export type UserRole = "CLIENT" | "OPERATOR" | "ADMIN";

export type User = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
};

export type AuthSession = {
  accessToken: string;
  refreshToken: string;
  tokenType: "bearer";
  expiresIn: number;
  user: User;
};

export type Sensor = {
  id: string;
  name: string;
  type: SensorType;
  mode: "SIMULATED" | "REAL";
  unit: string;
  locationId: string;
  isActive: boolean;
  online: boolean;
  lastSeen: string | null;
  value: number | null;
  quality: number | null;
};

export type ForecastParameter = {
  type: SensorType;
  current: number;
  predicted: number;
  trendPerHour: number;
  r2: number;
  samples: number;
};

export type Forecast = {
  score: number | null;
  confidence: number;
  horizonMinutes: number;
  method: string;
  parameters: ForecastParameter[];
};

export type Location = {
  id: string;
  name: string;
  city: string;
  address: string;
  latitude: number;
  longitude: number;
  score: number | null;
  status: string;
  sensors: Sensor[];
  forecast: Forecast | null;
};

export type Dashboard = {
  region: string;
  updatedAt: string;
  overallScore: number | null;
  onlineSensors: number;
  totalSensors: number;
  locations: Location[];
};

export type HistoryPoint = {
  at: string;
  score: number | null;
  values: Record<string, number>;
};

