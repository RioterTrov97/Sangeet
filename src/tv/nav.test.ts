import { setBeforeLeaveNow, setBeforeLeaveRoot, setBeforeShowRoot, useTvNav } from './nav';

describe('tv nav hooks', () => {
  beforeEach(() => useTvNav.setState({ stack: [{ name: 'home' }] }));
  afterEach(() => {
    setBeforeLeaveRoot(undefined);
    setBeforeShowRoot(undefined);
    setBeforeLeaveNow(undefined);
  });

  it('calls beforeLeaveRoot with the root name when it is covered or replaced, not for deeper pushes', () => {
    const f = jest.fn();
    setBeforeLeaveRoot(f);
    useTvNav.getState().push({ name: 'now' });
    expect(f).toHaveBeenCalledWith('home');
    useTvNav.getState().push({ name: 'album', id: 'a' });
    expect(f).toHaveBeenCalledTimes(1);
    useTvNav.setState({ stack: [{ name: 'search' }] });
    useTvNav.getState().root({ name: 'library' });
    expect(f).toHaveBeenLastCalledWith('search');
  });
  it('calls beforeShowRoot for the root being revealed (rail choice, or Back to the root)', () => {
    const f = jest.fn();
    setBeforeShowRoot(f);
    useTvNav.getState().root({ name: 'search' });
    expect(f).toHaveBeenLastCalledWith('search');
    useTvNav.getState().push({ name: 'album', id: 'a' });
    useTvNav.getState().push({ name: 'now' });
    useTvNav.getState().pop();
    expect(f).toHaveBeenCalledTimes(1); // still covered by the album
    useTvNav.getState().pop();
    expect(f).toHaveBeenLastCalledWith('search');
  });
  it('calls beforeLeaveNow before the stack changes, on pop, push and root', () => {
    const seen: string[] = [];
    setBeforeLeaveNow(() => seen.push(useTvNav.getState().stack[useTvNav.getState().stack.length - 1].name));
    useTvNav.getState().push({ name: 'now' });
    useTvNav.getState().pop();
    expect(seen).toEqual(['now']);
    useTvNav.getState().push({ name: 'now' });
    useTvNav.getState().root({ name: 'search' });
    expect(seen).toEqual(['now', 'now']);
    useTvNav.getState().push({ name: 'now' });
    useTvNav.getState().push({ name: 'album', id: 'x' });
    expect(seen).toEqual(['now', 'now', 'now']);
  });
  it('does nothing when leaving other screens', () => {
    const f = jest.fn();
    setBeforeLeaveNow(f);
    useTvNav.getState().push({ name: 'album', id: 'a' });
    useTvNav.getState().pop();
    expect(f).not.toHaveBeenCalled();
  });
});
