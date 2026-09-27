import { LOCAL_RESOLVERS } from './local';
import { reddit } from './reddit';
import { spotify } from './spotify';
import { PlatformResolver, Resolver } from './types';
import { vimeo } from './vimeo';
import { x } from './x';
import { youtube } from './youtube';

export { LOCAL_RESOLVERS };
export const PLATFORM_RESOLVERS: PlatformResolver[] = [youtube, spotify, x, reddit, vimeo];
/** Tier order: local first, then platform. Tier B has no resolver object; see backend.ts. */
export const RESOLVERS: Resolver[] = [...LOCAL_RESOLVERS, ...PLATFORM_RESOLVERS];
