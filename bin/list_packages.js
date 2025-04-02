import pkg from "../package.json" with {type: "json"}


pkg.workspaces.forEach((workspace) => {
    console.log(workspace)
});