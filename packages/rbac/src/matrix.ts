import { Roles, RoleType } from "@cs/identity";

export const Capabilities = {
  MODULE_READ: "module.read",
  MODULE_WRITE: "module.write",
  KIT_READ: "kit.read",
  KIT_RUN: "kit.run",
  KIT_REVIEW: "kit.review",
  KIT_ADMIN: "kit.admin",
  CONTROL_READ: "control.read",
  HUB_ADMIN: "hub.admin"
} as const;

export type CapabilityType = typeof Capabilities[keyof typeof Capabilities];

// Section 4.3 RBAC Capability Matrix
export const ROLE_CAPABILITIES: Record<RoleType, CapabilityType[]> = {
  [Roles.VIEWER]: [
    Capabilities.MODULE_READ,
    Capabilities.KIT_READ,
    Capabilities.CONTROL_READ
  ],
  [Roles.EDITOR]: [
    Capabilities.MODULE_READ,
    Capabilities.MODULE_WRITE,
    Capabilities.KIT_READ,
    Capabilities.KIT_REVIEW
  ],
  [Roles.MIGRATION_RUNNER]: [
    Capabilities.KIT_READ,
    Capabilities.KIT_RUN
  ],
  [Roles.ANALYST]: [
    Capabilities.MODULE_READ,
    Capabilities.KIT_READ,
    Capabilities.CONTROL_READ
  ],
  [Roles.ADMIN]: [
    Capabilities.MODULE_READ,
    Capabilities.MODULE_WRITE,
    Capabilities.KIT_READ,
    Capabilities.KIT_REVIEW,
    Capabilities.KIT_ADMIN,
    Capabilities.CONTROL_READ,
    Capabilities.HUB_ADMIN
  ]
};

export function hasCapability(userRoles: RoleType[], requiredCapability: CapabilityType): boolean {
  for (const role of userRoles) {
    const granted = ROLE_CAPABILITIES[role] || [];
    if (granted.includes(requiredCapability)) {
      return true;
    }
  }
  return false;
}
