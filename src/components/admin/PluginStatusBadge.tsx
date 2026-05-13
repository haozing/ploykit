/**
 * ===========================================================================
 * Plugin Status Badge Component
 * ===========================================================================
 *
 * Display three plugin states:
 * - Not Installed
 * - Disabled
 * - Enabled
 */

interface PluginStatusBadgeProps {
  installed: boolean;
  enabled?: boolean;
}

export function PluginStatusBadge({ installed, enabled }: PluginStatusBadgeProps) {
  // Not installed
  if (!installed) {
    return (
      <span
        className={`
          inline-flex items-center
          px-2.5 py-0.5
          rounded-full
          text-xs font-medium
          bg-muted text-muted-foreground
        `}
      >
        Not Installed
      </span>
    );
  }

  // Disabled
  if (!enabled) {
    return (
      <span
        className={`
          inline-flex items-center
          px-2.5 py-0.5
          rounded-full
          text-xs font-medium
          bg-muted text-muted-foreground
        `}
      >
        Disabled
      </span>
    );
  }

  // Enabled
  return (
    <span
      className={`
        inline-flex items-center
        px-2.5 py-0.5
        rounded-full
        text-xs font-medium
        bg-success text-success-foreground
      `}
    >
      Enabled
    </span>
  );
}
