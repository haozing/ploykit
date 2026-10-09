
import { SiteBanner } from './SiteBanner';
import { useSiteConfig } from '../hooks/useSiteConfig';

export interface SiteBannerLayerProps {
  
  maintenanceText?: string;
}

export function SiteBannerLayer({
  maintenanceText,
}: SiteBannerLayerProps = {}) {
  const { data } = useSiteConfig();
  if (!data) return null;
  return (
    <>
      {data.maintenance_mode === '1' && (
        <SiteBanner
          text={maintenanceText ?? '维护中：系统维护中，功能可能出现短暂不可用'}
          kind="warn"
        />
      )}
      <SiteBanner
        text={data.banner_text}
        kind={data.banner_kind === 'warn' ? 'warn' : 'info'}
      />
    </>
  );
}
