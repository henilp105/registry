"""
Simple in-memory caching utilities.
For production, consider using Redis or Memcached.
"""
import time
from functools import wraps
from typing import Any, Optional, Callable
from collections import OrderedDict
import threading
import hashlib
import json

# Thread-safe cache storage
_cache_lock = threading.RLock()
_cache: OrderedDict = OrderedDict()
_cache_timestamps: dict = {}

# Configuration
MAX_CACHE_SIZE = 1000
DEFAULT_TTL = 300  # 5 minutes


def _make_cache_key(*args, **kwargs) -> str:
    """Generate a cache key from arguments."""
    key_data = json.dumps({"args": args, "kwargs": kwargs}, sort_keys=True, default=str)
    return hashlib.md5(key_data.encode()).hexdigest()


def _is_expired(key: str, ttl: int) -> bool:
    """Check if a cache entry is expired."""
    if key not in _cache_timestamps:
        return True
    return (time.time() - _cache_timestamps[key]) > ttl


def _cleanup_cache():
    """Remove oldest entries if cache is too large."""
    with _cache_lock:
        while len(_cache) > MAX_CACHE_SIZE:
            oldest_key = next(iter(_cache))
            del _cache[oldest_key]
            if oldest_key in _cache_timestamps:
                del _cache_timestamps[oldest_key]


def cache_get(key: str, ttl: int = DEFAULT_TTL) -> Optional[Any]:
    """
    Get a value from cache if it exists and is not expired.
    """
    with _cache_lock:
        if key in _cache and not _is_expired(key, ttl):
            # Move to end (LRU)
            _cache.move_to_end(key)
            return _cache[key]
        
        # Remove expired entry
        if key in _cache:
            del _cache[key]
            if key in _cache_timestamps:
                del _cache_timestamps[key]
        
        return None


def cache_set(key: str, value: Any) -> None:
    """
    Set a value in cache.
    """
    with _cache_lock:
        _cache[key] = value
        _cache_timestamps[key] = time.time()
        _cleanup_cache()


def cache_delete(key: str) -> None:
    """
    Delete a value from cache.
    """
    with _cache_lock:
        if key in _cache:
            del _cache[key]
        if key in _cache_timestamps:
            del _cache_timestamps[key]


def cache_clear() -> None:
    """
    Clear all cache entries.
    """
    with _cache_lock:
        _cache.clear()
        _cache_timestamps.clear()


def cache_invalidate_pattern(pattern: str) -> int:
    """
    Invalidate all cache entries matching a pattern prefix.
    Returns the number of entries invalidated.
    """
    with _cache_lock:
        keys_to_delete = [k for k in _cache.keys() if k.startswith(pattern)]
        for key in keys_to_delete:
            del _cache[key]
            if key in _cache_timestamps:
                del _cache_timestamps[key]
        return len(keys_to_delete)


def cached(prefix: str = "", ttl: int = DEFAULT_TTL):
    """
    Decorator to cache function results.
    
    Args:
        prefix: Cache key prefix for easier invalidation
        ttl: Time to live in seconds
    
    Usage:
        @cached(prefix="packages", ttl=60)
        def get_packages(page):
            ...
    """
    def decorator(f: Callable):
        @wraps(f)
        def wrapper(*args, **kwargs):
            # Generate cache key
            func_key = f"{prefix}:{f.__name__}" if prefix else f.__name__
            args_key = _make_cache_key(*args, **kwargs)
            cache_key = f"{func_key}:{args_key}"
            
            # Try to get from cache
            cached_result = cache_get(cache_key, ttl)
            if cached_result is not None:
                return cached_result
            
            # Execute function and cache result
            result = f(*args, **kwargs)
            cache_set(cache_key, result)
            
            return result
        
        # Expose cache control methods
        wrapper.cache_clear = lambda: cache_invalidate_pattern(
            f"{prefix}:{f.__name__}" if prefix else f.__name__
        )
        
        return wrapper
    return decorator


# Specific cache helpers for common patterns
def get_namespace_cache_key(namespace: str) -> str:
    """Generate cache key for namespace data."""
    return f"namespace:{namespace}"


def get_package_cache_key(namespace: str, package: str) -> str:
    """Generate cache key for package data."""
    return f"package:{namespace}:{package}"


def get_user_cache_key(identifier: str) -> str:
    """Generate cache key for user data."""
    return f"user:{identifier}"


def invalidate_namespace_cache(namespace: str) -> None:
    """Invalidate all cache entries for a namespace."""
    cache_invalidate_pattern(f"namespace:{namespace}")
    cache_invalidate_pattern(f"package:{namespace}")


def invalidate_package_cache(namespace: str, package: str) -> None:
    """Invalidate cache for a specific package."""
    cache_delete(get_package_cache_key(namespace, package))


def invalidate_user_cache(identifier: str) -> None:
    """Invalidate cache for a specific user."""
    cache_delete(get_user_cache_key(identifier))
