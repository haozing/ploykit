
import { useQuery } from '@tanstack/react-query';
import { api } from '@ploykit/client';


export const SITE_CONFIG_QUERY_KEY = ['site-config'] as const;


export interface SiteConfig {
  
  oauth_providers?: string[];
  
  billing_channels?: string[];
  
  banner_text?: string;
  
  banner_kind?: string;
  
  maintenance_mode?: string;
  
  allow_signup?: string;
  
  allowed_domains?: string;
  
  mail_mode?: string;
}

export function useSiteConfig() {
  return useQuery({
    queryKey: SITE_CONFIG_QUERY_KEY,
    
    
    
    queryFn: () => api.get<SiteConfig>('/config'),
    staleTime: 5 * 60_000,
    retry: false,
  });
}
