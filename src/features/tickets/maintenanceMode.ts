export type MaintenanceConfig = {
  maintenance_mode?: boolean | null;
  maintenance_ends_at?: string | null;
};

const STORAGE_KEY = 'ticket-maintenance-status:v1';

export const saveMaintenanceConfig = (
  config: MaintenanceConfig | undefined,
) => {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        maintenanceMode: config?.maintenance_mode === true,
        endsAt:
          typeof config?.maintenance_ends_at === 'string'
            ? config.maintenance_ends_at
            : null,
      }),
    );
  } catch {
    // Storage is only a convenience for the ticket detail page.
  }
};

export const readMaintenanceConfig = (): {
  maintenanceMode: boolean;
  endsAt: string | null;
} => {
  try {
    const value = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ?? '{}',
    ) as {
      maintenanceMode?: unknown;
      endsAt?: unknown;
    };
    return {
      maintenanceMode: value.maintenanceMode === true,
      endsAt: typeof value.endsAt === 'string' ? value.endsAt : null,
    };
  } catch {
    return { maintenanceMode: false, endsAt: null };
  }
};

export const formatMaintenanceEndAt = (endsAt: string | null | undefined) => {
  if (!endsAt || Number.isNaN(new Date(endsAt).getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(endsAt));
};
