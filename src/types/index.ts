export type Locale = "en" | "es";

export interface NavItem {
  key: string;
  label: string;
  href: string;
}

export interface MetricItem {
  label: string;
  value: string;
}

export interface SocialLink {
  name: string;
  url: string;
  icon: string;
}
