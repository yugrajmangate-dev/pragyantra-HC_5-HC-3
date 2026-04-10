export type ReplayStatus = "Safe" | "Warning" | "Critical Outbreak Risk";

export type DemoReplayFocus = {
  clock: string;
  region: string;
  riskScore: number;
  cases: number;
  status: ReplayStatus;
  latitude: number;
  longitude: number;
  progress: number;
};
