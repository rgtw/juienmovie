'use client';

import { createContext, ReactNode, useContext } from 'react';

const SiteContext = createContext<{
  siteName: string;
  announcement?: string;
  tmdbApiKey?: string;
}>({
  // 默認值
  siteName: 'MoonTVPlus',
  announcement:
    '本網站僅提供影視信息搜索服務，所有內容均來自第三方網站。本站不存儲任何視頻資源，不對任何內容的準確性、合法性、完整性負責。',
  tmdbApiKey: '',
});

export const useSite = () => useContext(SiteContext);

export function SiteProvider({
  children,
  siteName,
  announcement,
  tmdbApiKey,
}: {
  children: ReactNode;
  siteName: string;
  announcement?: string;
  tmdbApiKey?: string;
}) {
  return (
    <SiteContext.Provider value={{ siteName, announcement, tmdbApiKey }}>
      {children}
    </SiteContext.Provider>
  );
}
