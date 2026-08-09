export interface DebouncedTask<T extends unknown[]> {
  (...args: T): void;
  cancel: () => void;
  flush: () => void;
}

export function debounce<T extends unknown[]>(callback: (...args: T) => void, wait: number): DebouncedTask<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let latest: T | undefined;
  const task = (...args: T) => {
    latest = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      if (latest) callback(...latest);
    }, wait);
  };
  task.cancel = () => { if (timer) clearTimeout(timer); timer = undefined; latest = undefined; };
  task.flush = () => {
    if (!timer || !latest) return;
    clearTimeout(timer);
    timer = undefined;
    callback(...latest);
  };
  return task;
}
