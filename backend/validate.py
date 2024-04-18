from app import app
import subprocess
import toml
import os
from mongo import db
from mongo import file_storage
from bson.objectid import ObjectId
from gridfs.errors import NoFile
import toml
from check_digests import check_digests
from bson.objectid import ObjectId
from typing import Union,List, Tuple, Dict, Any


def run_command(command: str) -> Union[str, None]:
    """
    Execute a shell command and return its output.

    Args:
        command (str): The command to execute.

    Returns:
        Union[str, None]: The standard output of the command if successful,
                          otherwise standard error.
    """
    result = subprocess.run(command, shell=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if result.returncode != 0:
        print(f"Error executing command: {command}")
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
    create_dir_command = f'mkdir -p static/temp/{packagename}'
    run_command(create_dir_command)
    extract_command = f'tar -xzf static/temp/{packagename}.tar.gz -C static/temp/{packagename}/'
    run_command(extract_command)

    generate_model = f"cd static/temp/{packagename} && fpm build --dump=fpm_model.json" # TODO: interim bug fix, disable after fpm v0.10.2
    run_command(generate_model)
    
    # Read fpm.toml
    toml_path = f'static/temp/{packagename}/fpm.toml'
    try:
        with open(toml_path, 'r') as file:
            file_content = file.read()
        parsed_toml = toml.loads(file_content) # handle toml parsing errors
    except:
        return False, None,"Error parsing toml file"
    
    result = check_digests(f'static/temp/{packagename}/')

    if os.path.exists(f'static/temp/{packagename}/README.md'):
        with open(f'static/temp/{packagename}/README.md', 'r') as file:
            parsed_toml['description'] = file.read()

    # Clean up
    cleanup_command = f'rm -rf static/temp/{packagename} static/temp/{packagename}.tar.gz'
    run_command(cleanup_command)
    print(result)

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
                packagename = package['name'] + '-' + i['version']
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
                
                for key in ['repository', 'copyright', 'description',"homepage", 'categories', 'keywords','registry_description']:
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


validate()