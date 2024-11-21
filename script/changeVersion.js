const fs = require("fs");
const path = require("path");

function changeVersion() {
    const packageJsonPath = path.join(__dirname, '../package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    const version = packageJson.version;

    // read README.md
    const readmePath = path.join(__dirname, '../README.md');
    let readmeContent = fs.readFileSync(readmePath, 'utf-8');
    readmeContent = readmeContent.replace(/### version \d+\.\d+\.\d+/, `### version ${version}`);
    fs.writeFileSync(readmePath, readmeContent, 'utf-8');

    // read changelog
    const changelogPath = path.join(__dirname, '../CHANGELOG.md');
    let changelogContent = fs.readFileSync(changelogPath, 'utf-8');
    // get the version of changelog
    const changelogVersion = changelogContent.match(/## \[\d+\.\d+\.\d+\] - \d{4}-\d{2}-\d{2}/)[0];
    const currentVersion = changelogVersion.split(']')[0].split('[')[1];
    if (currentVersion === version) {
        console.log('CHANGELOG current version:', changelogVersion);
        console.log('PACKAGE current version:', version);
    } else {
        const addContent = `## [${version}] - ${new Date().toISOString().split('T')[0]}\n\n- do something`;
        const contentChunks = changelogContent.split(changelogVersion);
        // take the first part and the last part of the changelog
        changelogContent = `${contentChunks[0]}${addContent}\n\n${changelogVersion}${contentChunks[1]}`;
        fs.writeFileSync(changelogPath, changelogContent, 'utf-8');
    }
}

changeVersion();