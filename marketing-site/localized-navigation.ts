import {locales,localePath,text,type Locale} from './src/i18n.js';
export function alternateLinks(route:string):string {
 const path=route?`/${route}/`:'/';
 return locales.map(locale=>`<link rel="alternate" hreflang="${locale}" href="https://getloynara.com${localePath(locale,path)}">`).join('')+`<link rel="alternate" hreflang="x-default" href="https://getloynara.com${path}">`;
}
export function languageSwitcher(locale:Locale,route:string):string {
 const path=route?`/${route}/`:'/';
 return `<nav class="language-switch" aria-label="${text('Sprache','Language','اللغة',locale)}">${locales.map(lang=>`<a lang="${lang}" hreflang="${lang}" href="${localePath(lang,path)}"${locale===lang?' aria-current="page"':''}>${{de:'DE',en:'EN',ar:'العربية'}[lang]}</a>`).join('')}</nav>`;
}
