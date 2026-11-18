import * as v from 'vitest';
import { buildRoute, matchRoute, type RouteParams } from '../src/sdk/routes.js';

v.describe('typed routes', () => {
  v.it('builds routes and encodes parameters', () => {
    const routes = {
      library: '/library',
      player: '/player/:id',
      tab: '/library/:section/:tab?',
    } as const;
    v.expect(buildRoute(routes.library)).toBe('/library');
    v.expect(buildRoute(routes.player, { id: 42 })).toBe('/player/42');
    v.expect(buildRoute(routes.player, { id: 'a b' })).toBe('/player/a%20b');
    v.expect(buildRoute(routes.tab, { section: 'movies', tab: 'recent' })).toBe(
      '/library/movies/recent',
    );
    v.expect(buildRoute(routes.tab, { section: 'movies' })).toBe(
      '/library/movies',
    );
    v.expect(() => buildRoute(routes.player, {} as never)).toThrowError(/id/);
  });

  v.it('matches concrete paths and decodes parameters', () => {
    v.expect(matchRoute('/player/:id', '/player/42?ref=home')).toEqual({
      id: '42',
    });
    v.expect(matchRoute('/player/:id', '/player/42/')).toEqual({ id: '42' });
    v.expect(matchRoute('/player/:id', '/player')).toBeNull();
    v.expect(matchRoute('/player/:id', '/library/42')).toBeNull();
    v.expect(matchRoute('/files/*', '/files/a/b.txt')).toEqual({
      '*': 'a/b.txt',
    });
    v.expect(
      matchRoute('/player/:id/edit/:tab', '/player/7/edit/audio'),
    ).toEqual({ id: '7', tab: 'audio' });
    v.expect(matchRoute('/a/:x?', '/a')).toEqual({});
  });

  v.it('infers parameter names from the pattern', () => {
    type Player = RouteParams<'/player/:id'>;
    type Nested = RouteParams<'/library/:section/edit/:tab'>;
    v.expectTypeOf<Player>().toEqualTypeOf<{ id: string | number }>();
    v.expectTypeOf<Nested>().toEqualTypeOf<{
      section: string | number;
      tab: string | number;
    }>();
  });
});
