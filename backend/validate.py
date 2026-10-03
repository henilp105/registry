import subprocess
import toml
import os
import re
import shutil
from mongo import db, file_storage
from bson.objectid import ObjectId
from gridfs.errors import NoFile
from typing import Union,List, Tuple, Dict, Any
import numpy as np
import json

def hash(lines):
    hash_val = np.int64(2166136261)
    FNV_PRIME = np.int64(16777619)
    for line in lines:
        for char in line:
            hash_val = (hash_val ^ np.int64(ord(char))) * FNV_PRIME
    return hash_val

def check_digests(file_path: str) -> Tuple[int, bool]:
    try:
        with open(f'{file_path}fpm_model.json', 'r') as file:
            model = json.load(file)
    except:
        return (-1, False)

    src_data: dict = model['packages'][model['package-name']] 
    error_count: int = 0

    for _, source_info in src_data['sources'].items():
        expected_digest: int = source_info['digest']
        file_name: str = source_info['file-name']
        
        try:
            with open(f'{file_path}{file_name.replace("./", "")}', 'r') as file:
                lines = file.read().splitlines()
        except:
            print(f'Error reading file content: {file_path}{file_name}')
            return (-1, False)

        computed_digest: int = hash(lines)

        if computed_digest != expected_digest:
            error_count += 1
            
    return (error_count, error_count == 0)


# Package names reach the filesystem and these subprocesses from the database.
# Anything outside this set is refused rather than escaped: the validator must not
# be able to be talked into running something else by a publisher (defect D7, still
# open in the legacy Flask validator -- the Worker and the GitHub Actions
# validator are shell-free by construction).
_SAFE_SEGMENT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._+-]*$")


def safe_segment(value: str) -> str:
    """Return `value` if it is a single safe path segment, else raise ValueError."""
    if not value or not _SAFE_SEGMENT.match(value) or value in {".", ".."}:
        raise ValueError(f"unsafe path segment: {value!r}")
    return value


def run_command(argv: List[str], cwd: Union[str, None] = None) -> Union[str, None]:
    """
    Execute a command and return its output.

    Args:
        argv (List[str]): The argument vector to execute. **Never a string.**
            A string with ``shell=True`` is command injection; this form has no
            shell to interpret metacharacters, so a package name is data.
        cwd (str): Optional working directory for the command.

    Returns:
        Union[str, None]: The standard output of the command if successful,
                          otherwise standard error.
    """
    result = subprocess.run(argv, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if result.returncode != 0:
        print(f"Error executing command: {argv}")
        print(result.stderr)
    return result.stdout if result.stdout else result.stderr

def extract_dependencies(parsed_toml: Dict[str, List[Dict[str, Any]]]) -> List[Tuple[str, str, str]]:
    """
    Extracts dependencies from a parsed TOML file.
    
    Args:
        parsed_toml (Dict[str, List[Dict[str, Any]]]): The parsed TOML file represented as a dictionary.

    Returns:
        List[Tuple[str, str, str]]: A list of dependency tuples containing (namespace, package_name, version).
    
    """
    dependencies = list()
    for dependency_name, dependency_info in parsed_toml.get('dependencies', {}).items():
        dependencies.append((dependency_info['namespace'], dependency_name, dependency_info.get('v', None)))
    for section in ['test', 'example', 'executable']:
        if section in parsed_toml and 'dependencies' in parsed_toml[section]:
            for dependency_name, dependency_info in parsed_toml[section].get('dependencies', {}).items():
                dependencies.append((dependency_info['namespace'], dependency_name, dependency_info.get('v', None)))
    return dependencies


def process_package(packagename: str) -> Tuple[bool, Union[dict, None], str]:
    """
    This function creates a directory, extracts package contents, reads and parses 'fpm.toml',
    checks digests, and cleans up temporary files.

    Args:
        packagename (str): The name of the package.

    Returns:
        Tuple[bool, Union[dict, None], str]: A tuple containing:
            - bool: Whether the package processing was successful.
            - Union[dict, None]: Parsed 'fpm.toml' content if successful, None otherwise.
            - str: Message describing the result of the package processing.
    """
    packagename = safe_segment(packagename)
    workdir = f'static/temp/{packagename}'
    # `mkdir -p` as argv, and `cwd` instead of `cd x && y`: no shell anywhere on
    # this path, so the package name cannot become a command.
    run_command(['mkdir', '-p', workdir])
    run_command(['tar', '-xzf', f'static/temp/{packagename}.tar.gz', '-C', workdir])

    run_command(['fpm', 'build', '--dump=fpm_model.json'], cwd=workdir) # TODO: interim bug fix, disable after fpm v0.10.2
    
    # Read fpm.toml
    toml_path = f'{workdir}/fpm.toml'
    try:
        with open(toml_path, 'r') as file:
            file_content = file.read()
        parsed_toml = toml.loads(file_content) # handle toml parsing errors
    except:
        return False, None,"Error parsing toml file"
    
    result = check_digests(f'static/temp/{packagename}/')
    # print(result)

    if result[0]==-1:
        # Package verification failed 
        return False, parsed_toml, "Digests do not match or file not found."
    else:
        # Package verification success
        return True, parsed_toml, "Package verified successfully."


def validate() -> None:
    """
    This function checks the verification status of packages, verifies their contents,
    updates package information, and ensures dependencies are present in the database.

    Args:
        None

    Returns:
        None
    """
    packages = db.packages.find({"is_verified": False})
    packages = list(packages)
    for  package in packages:
        for i in package['versions']:
            if 'is_verified' in i.keys() and i['is_verified'] == False:
                try:
                    tarball = file_storage.get(ObjectId(i['oid']))
                except NoFile:
                    print("No tarball found for " + package['name'] + " " + i['version'])
                    continue
                # Refuse a name that is not a single safe path segment before it
                # becomes a directory, a tarball path and a set of argv entries.
                # Skipping is the right response: one malformed package name must
                # not stop the whole validation queue.
                try:
                    packagename = safe_segment(package['name'] + '-' + i['version'])
                except ValueError as exc:
                    print(f"Skipping package with unusable name: {exc}")
                    continue
                os.makedirs('static/temp', exist_ok=True)
                with open(f"static/temp/{packagename}.tar.gz", "wb") as f:
                    f.write(tarball.read())
                result = process_package(packagename)
                update_data = {}
                if result[0] == False:
                    update_data['is_verified'] = False
                    update_data['unable_to_verify'] = True
                    print("Package tests failed for " + packagename)
                    print(result)
                else:
                    print("Package tests success for " + packagename)
                    update_data['is_verified'] = True
                    update_data['unable_to_verify'] = False

                if result[2] == "Error parsing toml file":
                    db.packages.update_one({"name": package['name'],"namespace":package['namespace']}, {"$set": update_data})
                    pass
                try:
                    update_data['registry_description'] = open(f"static/temp/{packagename}/README.md", "r").read()     
                except:
                    update_data['registry_description'] = result[1].get('description', "description not provided.")
                
                for key in ['repository', 'copyright', 'description',"homepage", 'categories', 'keywords']:
                    if key in result[1] and package[key] != result[1][key]:
                        if key in ['categories', 'keywords']:
                            update_data[key] = list(set(package[key] + list(map(str.strip, result[1][key]))))
                        else:
                            update_data[key] = result[1][key]

                dependencies = extract_dependencies(result[1])

                for i in dependencies:
                    namespace = db.namespaces.find_one({"namespace": i[0]})
                    query = {"name": i[1], "namespace": ObjectId(str(namespace['_id']))}
                    if i[2] is not None:
                        query['versions.version'] = i[2]
                    dependency_package = db.packages.find_one(query)
                    if dependency_package is None:
                        print(f"Dependency {i[0]}/{i[1]} not found in the database")
                        update_data['is_verified'] = False    

                for k,v in package.items():
                    if v == "Package Under Verification" and k not in update_data.keys():
                        update_data[k] = f"{k} not provided."

                db.packages.update_one({"name": package['name'],"namespace":package['namespace']}, {"$set": update_data})
                print(f"Package {packagename} verified successfully.")
                # Clean up. `shutil` rather than `rm -rf` in a shell string: same
                # result, no shell to be talked into deleting something else.
                shutil.rmtree(f'static/temp/{packagename}', ignore_errors=True)
                try:
                    os.remove(f'static/temp/{packagename}.tar.gz')
                except OSError:
                    pass


if __name__ == "__main__":
    import time
    
    # Run validation in a loop with configurable interval
    VALIDATION_INTERVAL = int(os.environ.get('VALIDATION_INTERVAL', 60))  # Default: 60 seconds
    
    print(f"Package validator started. Checking every {VALIDATION_INTERVAL} seconds...")
    
    while True:
        try:
            validate()
        except Exception as e:
            print(f"Error during validation: {e}")
        
        time.sleep(VALIDATION_INTERVAL)