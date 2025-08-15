 import { QualityFilter } from './filter.js';
 import { containsLanguage, LanguageOptions } from './languages.js';
 import { Type } from './types.js';
 import { hasMochConfigured } from '../moch/moch.js';
 import { extractSeeders, extractSize } from './titleHelper.js';
+import { applyAutoStream } from './autostream.js';

 export const SortOptions = {
   key: 'sort',
   options: {
     qualitySeeders: { key: 'quality', description: 'By quality then seeders' },
     qualitySize:    { key: 'qualitysize', description: 'By quality then size' },
     seeders:        { key: 'seeders', description: 'By seeders' },
     size:           { key: 'size', description: 'By size' },
+    autostream:     { key: 'autostream', description: 'AutoStream scoring (quality+seeds), optional 1080p second' },
   }
 }

 export default function sortStreams(streams, config, type) {
   const languages = config[LanguageOptions.key];
   if (languages?.length && languages[0] !== 'english') {
     const streamsWithLanguage = streams.filter(stream => containsLanguage(stream, languages));
     const streamsNoLanguage = streams.filter(stream => !streamsWithLanguage.includes(stream));
     return _sortStreams(streamsWithLanguage, config, type).concat(_sortStreams(streamsNoLanguage, config, type));
   }
   return _sortStreams(streams, config, type);
 }

 function _sortStreams(streams, config, type) {
   const sort = config?.sort?.toLowerCase() || undefined;
   const limit = /^[1-9][0-9]*$/.test(config.limit) && parseInt(config.limit) || undefined;
+
+  if (sort === SortOptions.options.autostream.key) {
+    // AutoStream returns 1–2 curated items already
+    return applyAutoStream(streams, config, type);
+  }
