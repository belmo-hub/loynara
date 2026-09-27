export const locales = ['de', 'en', 'ar'];
export function currentLocale() {
    const lang = typeof document === 'undefined' ? 'de' : document.documentElement.lang;
    return lang === 'en' || lang === 'ar' ? lang : 'de';
}
export function localeTag(locale = currentLocale()) { return { de: 'de-DE', en: 'en-GB', ar: 'ar-u-nu-latn' }[locale]; }
export function text(de, en, ar, locale = currentLocale()) { return { de, en, ar }[locale]; }
/** Local routes only. Assets are shared, anchors stay on the current page. */
export function localePath(locale, path = '/') {
    if (path.startsWith('#') || path.startsWith('/assets/') || path === '/styles.css')
        return path;
    const route = path.replace(/^\/(?:en|ar)(?=\/|$)/, '').replace(/^\//, '');
    return `${locale === 'de' ? '' : `/${locale}`}/${route}`;
}
