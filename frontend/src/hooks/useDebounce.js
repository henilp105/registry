import { useCallback, useRef, useEffect, useState } from 'react';

/**
 * Custom hook for debouncing values.
 * Useful for search inputs to prevent excessive API calls.
 * 
 * @param {any} value - The value to debounce
 * @param {number} delay - Delay in milliseconds
 * @returns {any} - Debounced value
 */
export const useDebounce = (value, delay = 300) => {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return debouncedValue;
};

/**
 * Custom hook for debounced callbacks.
 * 
 * @param {Function} callback - The function to debounce
 * @param {number} delay - Delay in milliseconds
 * @returns {Function} - Debounced callback
 */
export const useDebouncedCallback = (callback, delay = 300) => {
  const timeoutRef = useRef(null);

  const debouncedCallback = useCallback(
    (...args) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => {
        callback(...args);
      }, delay);
    },
    [callback, delay]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return debouncedCallback;
};

/**
 * Custom hook for tracking previous value.
 * 
 * @param {any} value - Current value
 * @returns {any} - Previous value
 */
export const usePrevious = (value) => {
  const ref = useRef();
  
  useEffect(() => {
    ref.current = value;
  }, [value]);
  
  return ref.current;
};

/**
 * Custom hook for handling keyboard shortcuts.
 * 
 * @param {Object} keyHandlers - Object mapping key codes to handlers
 * @param {boolean} enabled - Whether to listen for keyboard events
 */
export const useKeyboardShortcuts = (keyHandlers, enabled = true) => {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event) => {
      const handler = keyHandlers[event.key];
      if (handler) {
        // Check for modifier keys if specified
        const modifiers = handler.modifiers || {};
        const modifiersMatch = 
          (!modifiers.ctrl || event.ctrlKey) &&
          (!modifiers.shift || event.shiftKey) &&
          (!modifiers.alt || event.altKey) &&
          (!modifiers.meta || event.metaKey);

        if (modifiersMatch) {
          if (handler.preventDefault !== false) {
            event.preventDefault();
          }
          handler.action(event);
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [keyHandlers, enabled]);
};

/**
 * Custom hook for local storage with state sync.
 * 
 * @param {string} key - Storage key
 * @param {any} initialValue - Initial value if not in storage
 * @returns {[any, Function]} - Current value and setter
 */
export const useLocalStorage = (key, initialValue) => {
  const [storedValue, setStoredValue] = useState(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      console.error(`Error reading localStorage key "${key}":`, error);
      return initialValue;
    }
  });

  const setValue = useCallback((value) => {
    try {
      const valueToStore = value instanceof Function ? value(storedValue) : value;
      setStoredValue(valueToStore);
      window.localStorage.setItem(key, JSON.stringify(valueToStore));
    } catch (error) {
      console.error(`Error setting localStorage key "${key}":`, error);
    }
  }, [key, storedValue]);

  return [storedValue, setValue];
};

/**
 * Custom hook for detecting outside clicks.
 * 
 * @param {Function} handler - Handler to call on outside click
 * @returns {Object} - Ref to attach to the element
 */
export const useOnClickOutside = (handler) => {
  const ref = useRef();

  useEffect(() => {
    const listener = (event) => {
      if (!ref.current || ref.current.contains(event.target)) {
        return;
      }
      handler(event);
    };

    document.addEventListener('mousedown', listener);
    document.addEventListener('touchstart', listener);

    return () => {
      document.removeEventListener('mousedown', listener);
      document.removeEventListener('touchstart', listener);
    };
  }, [handler]);

  return ref;
};

/**
 * Custom hook for intersection observer (lazy loading).
 * 
 * @param {Object} options - Intersection observer options
 * @returns {[Object, boolean]} - Ref and isVisible state
 */
export const useIntersectionObserver = (options = {}) => {
  const [isVisible, setIsVisible] = useState(false);
  const ref = useRef();

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      setIsVisible(entry.isIntersecting);
    }, {
      threshold: options.threshold || 0.1,
      rootMargin: options.rootMargin || '0px',
      ...options
    });

    const currentRef = ref.current;
    if (currentRef) {
      observer.observe(currentRef);
    }

    return () => {
      if (currentRef) {
        observer.unobserve(currentRef);
      }
    };
  }, [options]);

  return [ref, isVisible];
};

/**
 * Custom hook for focus trap (accessibility).
 * 
 * @param {boolean} isActive - Whether the trap is active
 * @returns {Object} - Ref to attach to the container
 */
export const useFocusTrap = (isActive) => {
  const ref = useRef();

  useEffect(() => {
    if (!isActive || !ref.current) return;

    const focusableElements = ref.current.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const firstFocusable = focusableElements[0];
    const lastFocusable = focusableElements[focusableElements.length - 1];

    const handleTabKey = (e) => {
      if (e.key !== 'Tab') return;

      if (e.shiftKey) {
        if (document.activeElement === firstFocusable) {
          lastFocusable?.focus();
          e.preventDefault();
        }
      } else {
        if (document.activeElement === lastFocusable) {
          firstFocusable?.focus();
          e.preventDefault();
        }
      }
    };

    ref.current.addEventListener('keydown', handleTabKey);
    firstFocusable?.focus();

    return () => {
      ref.current?.removeEventListener('keydown', handleTabKey);
    };
  }, [isActive]);

  return ref;
};

export default {
  useDebounce,
  useDebouncedCallback,
  usePrevious,
  useKeyboardShortcuts,
  useLocalStorage,
  useOnClickOutside,
  useIntersectionObserver,
  useFocusTrap
};
