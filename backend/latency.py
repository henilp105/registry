"""
Latency Testing Module for FPM Registry API

This module provides functionality to test response times of all API endpoints
using real data from the database. It measures latency for each endpoint and
provides comprehensive performance metrics.
"""

import time
import logging
from typing import Dict, List, Any, Optional, Tuple
from dataclasses import dataclass, asdict
from flask import Flask, jsonify, request
import requests
from functools import wraps

logger = logging.getLogger(__name__)


@dataclass
class EndpointResult:
    """Result of a single endpoint latency test."""
    endpoint: str
    method: str
    status_code: int
    latency_ms: float
    success: bool
    error: Optional[str] = None
    category: str = "general"


@dataclass 
class LatencyReport:
    """Complete latency test report."""
    total_endpoints: int
    successful: int
    failed: int
    total_time_ms: float
    avg_latency_ms: float
    min_latency_ms: float
    max_latency_ms: float
    results: List[Dict[str, Any]]
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "total_endpoints": self.total_endpoints,
            "successful": self.successful,
            "failed": self.failed,
            "total_time_ms": round(self.total_time_ms, 2),
            "avg_latency_ms": round(self.avg_latency_ms, 2),
            "min_latency_ms": round(self.min_latency_ms, 2),
            "max_latency_ms": round(self.max_latency_ms, 2),
            "results": self.results
        }


def measure_latency(func):
    """Decorator to measure function execution time."""
    @wraps(func)
    def wrapper(*args, **kwargs):
        start = time.perf_counter()
        result = func(*args, **kwargs)
        end = time.perf_counter()
        latency_ms = (end - start) * 1000
        return result, latency_ms
    return wrapper


class LatencyTester:
    """
    Tests latency of API endpoints using real database data.
    
    This class provides methods to test various API endpoints and measure
    their response times. It uses Flask's test client for internal testing
    or can make real HTTP requests.
    """
    
    def __init__(self, app: Flask, base_url: str = "http://localhost:9090"):
        """
        Initialize the latency tester.
        
        Args:
            app: Flask application instance
            base_url: Base URL for HTTP requests (used for external testing)
        """
        self.app = app
        self.base_url = base_url
        self.client = app.test_client()
        self.results: List[EndpointResult] = []
        
    def _test_endpoint(
        self, 
        endpoint: str, 
        method: str = "GET",
        data: Optional[Dict] = None,
        headers: Optional[Dict] = None,
        category: str = "general"
    ) -> EndpointResult:
        """
        Test a single endpoint and measure its latency.
        
        Args:
            endpoint: The endpoint path to test
            method: HTTP method (GET, POST, etc.)
            data: Request body data (for POST requests)
            headers: Request headers
            category: Category for grouping results
            
        Returns:
            EndpointResult with latency measurements
        """
        headers = headers or {"Content-Type": "application/json"}
        
        start = time.perf_counter()
        try:
            if method == "GET":
                response = self.client.get(endpoint, headers=headers)
            elif method == "POST":
                response = self.client.post(
                    endpoint, 
                    json=data,
                    headers=headers
                )
            else:
                response = self.client.get(endpoint, headers=headers)
                
            end = time.perf_counter()
            latency_ms = (end - start) * 1000
            
            result = EndpointResult(
                endpoint=endpoint,
                method=method,
                status_code=response.status_code,
                latency_ms=round(latency_ms, 2),
                success=response.status_code < 400,
                category=category
            )
            
        except Exception as e:
            end = time.perf_counter()
            latency_ms = (end - start) * 1000
            
            result = EndpointResult(
                endpoint=endpoint,
                method=method,
                status_code=500,
                latency_ms=round(latency_ms, 2),
                success=False,
                error=str(e),
                category=category
            )
            
        self.results.append(result)
        return result
    
    def test_health_endpoints(self) -> List[EndpointResult]:
        """Test health check endpoints."""
        results = []
        results.append(self._test_endpoint("/", "GET", category="health"))
        results.append(self._test_endpoint("/health", "GET", category="health"))
        return results
    
    def test_package_endpoints(self) -> List[EndpointResult]:
        """Test package-related endpoints with real data."""
        from mongo import db
        
        results = []
        
        # Test packages list endpoint
        results.append(self._test_endpoint("/packages", "GET", category="packages"))
        results.append(self._test_endpoint("/packages?page=1&limit=10", "GET", category="packages"))
        results.append(self._test_endpoint("/packages?query=test", "GET", category="packages"))
        
        # Test packages_cli endpoint
        results.append(self._test_endpoint("/packages_cli", "GET", category="packages"))
        
        # Test with real package data if available
        package = db.packages.find_one()
        if package:
            namespace = db.namespaces.find_one({"_id": package.get("namespace")})
            if namespace:
                ns_name = namespace.get("namespace", "test")
                pkg_name = package.get("name", "test")
                
                # Test package detail endpoint
                results.append(self._test_endpoint(
                    f"/packages/{ns_name}/{pkg_name}", 
                    "GET", 
                    category="packages"
                ))
                
                # Test package maintainers endpoint
                results.append(self._test_endpoint(
                    f"/packages/{ns_name}/{pkg_name}/maintainers",
                    "GET",
                    category="packages"
                ))
                
                # Test version endpoint if versions exist
                versions = package.get("versions", [])
                if versions:
                    version = versions[0].get("version", "0.1.0")
                    results.append(self._test_endpoint(
                        f"/packages/{ns_name}/{pkg_name}/{version}",
                        "GET",
                        category="packages"
                    ))
        
        return results
    
    def test_namespace_endpoints(self) -> List[EndpointResult]:
        """Test namespace-related endpoints with real data."""
        from mongo import db
        
        results = []
        
        # Test with real namespace data if available
        namespace = db.namespaces.find_one()
        if namespace:
            ns_name = namespace.get("namespace", "test")
            
            # Test namespace detail endpoint
            results.append(self._test_endpoint(
                f"/namespace/{ns_name}",
                "GET",
                category="namespaces"
            ))
        
        return results
    
    def test_user_endpoints(self) -> List[EndpointResult]:
        """Test user-related endpoints with real data."""
        from mongo import db
        
        results = []
        
        # Test with real user data if available
        user = db.users.find_one()
        if user:
            username = user.get("username", "testuser")
            
            # Test user profile endpoint
            results.append(self._test_endpoint(
                f"/users/{username}",
                "GET",
                category="users"
            ))
        
        return results
    
    def test_database_operations(self) -> List[EndpointResult]:
        """Test database query performance."""
        from mongo import db, count_documents_fast
        
        results = []
        
        # Test packages count
        start = time.perf_counter()
        try:
            count = count_documents_fast(db.packages)
            end = time.perf_counter()
            latency_ms = (end - start) * 1000
            
            results.append(EndpointResult(
                endpoint="db:packages.count",
                method="QUERY",
                status_code=200,
                latency_ms=round(latency_ms, 2),
                success=True,
                category="database"
            ))
        except Exception as e:
            end = time.perf_counter()
            results.append(EndpointResult(
                endpoint="db:packages.count",
                method="QUERY",
                status_code=500,
                latency_ms=round((end - start) * 1000, 2),
                success=False,
                error=str(e),
                category="database"
            ))
        
        # Test namespaces count
        start = time.perf_counter()
        try:
            count = count_documents_fast(db.namespaces)
            end = time.perf_counter()
            latency_ms = (end - start) * 1000
            
            results.append(EndpointResult(
                endpoint="db:namespaces.count",
                method="QUERY",
                status_code=200,
                latency_ms=round(latency_ms, 2),
                success=True,
                category="database"
            ))
        except Exception as e:
            end = time.perf_counter()
            results.append(EndpointResult(
                endpoint="db:namespaces.count",
                method="QUERY",
                status_code=500,
                latency_ms=round((end - start) * 1000, 2),
                success=False,
                error=str(e),
                category="database"
            ))
        
        # Test users count
        start = time.perf_counter()
        try:
            count = count_documents_fast(db.users)
            end = time.perf_counter()
            latency_ms = (end - start) * 1000
            
            results.append(EndpointResult(
                endpoint="db:users.count",
                method="QUERY",
                status_code=200,
                latency_ms=round(latency_ms, 2),
                success=True,
                category="database"
            ))
        except Exception as e:
            end = time.perf_counter()
            results.append(EndpointResult(
                endpoint="db:users.count",
                method="QUERY",
                status_code=500,
                latency_ms=round((end - start) * 1000, 2),
                success=False,
                error=str(e),
                category="database"
            ))
        
        # Test find_one query on packages
        start = time.perf_counter()
        try:
            package = db.packages.find_one()
            end = time.perf_counter()
            latency_ms = (end - start) * 1000
            
            results.append(EndpointResult(
                endpoint="db:packages.find_one",
                method="QUERY",
                status_code=200,
                latency_ms=round(latency_ms, 2),
                success=True,
                category="database"
            ))
        except Exception as e:
            end = time.perf_counter()
            results.append(EndpointResult(
                endpoint="db:packages.find_one",
                method="QUERY",
                status_code=500,
                latency_ms=round((end - start) * 1000, 2),
                success=False,
                error=str(e),
                category="database"
            ))
        
        self.results.extend(results)
        return results
    
    def run_all_tests(self) -> LatencyReport:
        """
        Run all latency tests and generate a comprehensive report.
        
        Returns:
            LatencyReport with all test results and statistics
        """
        self.results = []  # Reset results
        
        total_start = time.perf_counter()
        
        # Run all test categories
        logger.info("Running health endpoint tests...")
        self.test_health_endpoints()
        
        logger.info("Running package endpoint tests...")
        self.test_package_endpoints()
        
        logger.info("Running namespace endpoint tests...")
        self.test_namespace_endpoints()
        
        logger.info("Running user endpoint tests...")
        self.test_user_endpoints()
        
        logger.info("Running database operation tests...")
        self.test_database_operations()
        
        total_end = time.perf_counter()
        total_time_ms = (total_end - total_start) * 1000
        
        # Calculate statistics
        successful = sum(1 for r in self.results if r.success)
        failed = len(self.results) - successful
        
        latencies = [r.latency_ms for r in self.results]
        avg_latency = sum(latencies) / len(latencies) if latencies else 0
        min_latency = min(latencies) if latencies else 0
        max_latency = max(latencies) if latencies else 0
        
        # Convert results to dictionaries
        results_dict = [asdict(r) for r in self.results]
        
        report = LatencyReport(
            total_endpoints=len(self.results),
            successful=successful,
            failed=failed,
            total_time_ms=total_time_ms,
            avg_latency_ms=avg_latency,
            min_latency_ms=min_latency,
            max_latency_ms=max_latency,
            results=results_dict
        )
        
        logger.info(f"Latency tests completed: {successful}/{len(self.results)} successful")
        
        return report


def get_latency_report(app: Flask) -> Dict[str, Any]:
    """
    Convenience function to run all latency tests and return a report.
    
    Args:
        app: Flask application instance
        
    Returns:
        Dictionary containing the complete latency report
    """
    tester = LatencyTester(app)
    report = tester.run_all_tests()
    return report.to_dict()
