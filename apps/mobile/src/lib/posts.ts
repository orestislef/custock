import type { Post } from '@custock/core';

// the post text in the reader's language, else the default language, else any
export function postText(post: Pick<Post, 'translations' | 'defaultLocale'>, lang: string) {
  return post.translations[lang] ?? post.translations[post.defaultLocale] ?? Object.values(post.translations)[0] ?? { title: '', body: '' };
}
