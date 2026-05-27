import type { PlanType } from "@prisma/client";

interface PlanLimits {
  maxPOsPerMonth: number;
  maxSuppliers: number;
  emailAlerts: boolean;
  cogsTracking: boolean;
  marginReport: boolean;
  csvExport: boolean;
}

const PLAN_LIMITS: Record<PlanType, PlanLimits> = {
  FREE: {
    maxPOsPerMonth: 5,
    maxSuppliers: 2,
    emailAlerts: true,
    cogsTracking: false,
    marginReport: false,
    csvExport: false,
  },
  STARTER: {
    maxPOsPerMonth: Infinity,
    maxSuppliers: 10,
    emailAlerts: true,
    cogsTracking: true,
    marginReport: false,
    csvExport: false,
  },
  PRO: {
    maxPOsPerMonth: Infinity,
    maxSuppliers: Infinity,
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
  const limits = getPlanLimits(plan);
  return currentMonthPOCount < limits.maxPOsPerMonth;
}

export function canCreateSupplier(
  plan: PlanType,
  currentSupplierCount: number,
): boolean {
  const limits = getPlanLimits(plan);
  return currentSupplierCount < limits.maxSuppliers;
}
