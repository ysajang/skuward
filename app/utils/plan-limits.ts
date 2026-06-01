import type { PlanType } from "@prisma/client";

export interface PlanLimits {
  maxPOsPerMonth: number;
  maxSuppliers: number;
  maxReorderRules: number;
  emailAlerts: boolean;
  cogsTracking: boolean;
  marginReport: boolean;
  csvExport: boolean;
}

const PLAN_LIMITS: Record<PlanType, PlanLimits> = {
  FREE: {
    maxPOsPerMonth: 5,
    maxSuppliers: 2,
    maxReorderRules: 3,
    emailAlerts: false,
    cogsTracking: false,
    marginReport: false,
    csvExport: false,
  },
  STARTER: {
    maxPOsPerMonth: Infinity,
    maxSuppliers: 10,
    maxReorderRules: Infinity,
    emailAlerts: false,
    cogsTracking: true,
    marginReport: false,
    csvExport: false,
  },
  PRO: {
    maxPOsPerMonth: Infinity,
    maxSuppliers: Infinity,
    maxReorderRules: Infinity,
    emailAlerts: true,
    cogsTracking: true,
    marginReport: true,
    csvExport: true,
  },
};

export function getPlanLimits(plan: PlanType): PlanLimits {
  return PLAN_LIMITS[plan];
}

export function canCreatePO(
  plan: PlanType,
  currentMonthPOCount: number,
): boolean {
  return currentMonthPOCount < getPlanLimits(plan).maxPOsPerMonth;
}

export function canCreateSupplier(
  plan: PlanType,
  currentSupplierCount: number,
): boolean {
  return currentSupplierCount < getPlanLimits(plan).maxSuppliers;
}

export function canCreateReorderRule(
  plan: PlanType,
  currentReorderRuleCount: number,
): boolean {
  return currentReorderRuleCount < getPlanLimits(plan).maxReorderRules;
}

export function canAccessCOGS(plan: PlanType): boolean {
  return getPlanLimits(plan).cogsTracking;
}
