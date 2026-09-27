export const locales = ['de','en','ar'] as const;
export type Locale = typeof locales[number];
export function currentLocale():Locale {
 const lang=typeof document==='undefined'?'de':document.documentElement.lang;
 return lang==='en'||lang==='ar'?lang:'de';
}
export function localeTag(locale:Locale=currentLocale()):string {return {de:'de-DE',en:'en-GB',ar:'ar-u-nu-latn'}[locale];}
export function text(de:string,en:string,ar:string,locale:Locale=currentLocale()):string {return {de,en,ar}[locale];}
/** Local routes only. Assets are shared, anchors stay on the current page. */
export function localePath(locale:Locale,path='/'):string {
 if(path.startsWith('#')||path.startsWith('/assets/')||path==='/styles.css')return path;
 const route=path.replace(/^\/(?:en|ar)(?=\/|$)/,'').replace(/^\//,'');
 return `${locale==='de'?'':`/${locale}`}/${route}`;
}
