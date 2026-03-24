/**
 * Browser-like request headers for Wowhead fetches (mitigate HTTP 403 on plain node-fetch).
 * Keep Chrome major version aligned across User-Agent and Sec-CH-UA.
 */
export const WOWHEAD_CHROME_MAJOR = '131';

export const WOWHEAD_USER_AGENT = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${WOWHEAD_CHROME_MAJOR}.0.0.0 Safari/537.36`;

const WOWHEAD_ORIGIN = 'https://www.wowhead.com';

const SEC_CH_UA = `"Google Chrome";v="${WOWHEAD_CHROME_MAJOR}", "Chromium";v="${WOWHEAD_CHROME_MAJOR}", "Not_A Brand";v="24"`;

/** Full navigation-style headers (HTML list pages, spell pages, item HTML). */
export const wowheadHtmlHeaders = {
  'User-Agent': WOWHEAD_USER_AGENT,
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  DNT: '1',
  Connection: 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  Referer: `${WOWHEAD_ORIGIN}/`,
  'Sec-Ch-Ua': SEC_CH_UA,
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'same-origin',
  'Sec-Fetch-User': '?1',
};

/** API/XML-style headers (item tooltips &xml). */
export const wowheadXmlHeaders = {
  'User-Agent': WOWHEAD_USER_AGENT,
  Accept: 'application/xml,text/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  DNT: '1',
  Connection: 'keep-alive',
  Referer: `${WOWHEAD_ORIGIN}/`,
  'Sec-Ch-Ua': SEC_CH_UA,
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
};
