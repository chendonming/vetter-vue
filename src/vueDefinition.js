const vscode = require("vscode");
const glob = require("glob");
const path = require("path");
const fs = require("fs");

function vueDefinition() {}
vueDefinition.prototype.VUE_ATTR = {
  props: 1,
  computed: 2,
  methods: 3,
  watch: 4,
  beforeCreate: 5,
  created: 6,
  beforeMount: 7,
  mounted: 8,
  beforeUpdate: 9,
  updated: 10,
  activated: 11,
  deactivated: 12,
  beforeDestroy: 13,
  destroyed: 14,
  directives: 15,
  filters: 16,
  components: 17,
  data: 18,
};

vueDefinition.prototype.getMain = async function (rootPath) {
  return await new Promise((resolve, reject) => {
    fs.readFile(rootPath + "package.json", "utf8", (err, data) => {
      if (err) reject(err);
      let p = {};
      try {
        p = JSON.parse(data);
      } catch (e) {
        console.log("e:", e);
      }
      if (p.main) {
        resolve(p.main);
      } else {
        resolve("");
      }
    });
  });
};

vueDefinition.prototype.getPlugin = async function (plugin) {
  return await new Promise((resolve, reject) => {
    fs.readFile(
      vscode.workspace.rootPath + path.sep + "package.json",
      "utf8",
      (err, data) => {
        if (err) reject(err);
        // 数组则是获取框架
        let ret = "";
        let p = {};
        try {
          p = JSON.parse(data);
        } catch (e) {
          console.log("e:", e);
        }
        let pluginArr = plugin.split("/");
        if (
          (pluginArr.length === 1 &&
            p.dependencies &&
            p.dependencies[plugin]) ||
          (p.devDependencies && p.devDependencies[plugin])
        ) {
          ret = plugin;
        } else if (
          (pluginArr.length > 1 &&
            p.dependencies &&
            p.dependencies[pluginArr[0]]) ||
          (p.devDependencies && p.devDependencies[pluginArr[0]])
        ) {
          ret = plugin;
        }

        if (ret) {
          resolve(ret);
        } else {
          resolve("");
        }
      }
    );
  });
};

vueDefinition.prototype.getDefinitionPosition = function (lineText) {
  const pathRegs = [
    /import\s+.*\s+from\s+['"](.*)['"]/,
    /import\s*[^'"]*\(['"](.*)['"]\)[^'"]*/,
    /.*require\s*\([^'"]*['"](.*)['"][^'"]*\)/,
    /import\s+['"](.*)['"]/,
    /import\s*\([^'"]*(?:\/\*.*\*\/)\s*['"](.*)['"][^'"]\)*/,
  ];
  let execResult;
  for (const pathReg of pathRegs) {
    execResult = pathReg.exec(lineText);
    if (execResult && execResult[1]) {
      const filePath = execResult[1];
      return {
        path: filePath,
      };
    }
  }
};

// 文件内跳转
vueDefinition.prototype.defineInFile = async function (
  document,
  position,
  line
) {
  const textSplite = [
    " ",
    "<",
    ">",
    '"',
    "'",
    ".",
    "\\",
    "=",
    ":",
    "@",
    "(",
    ")",
    "[",
    "]",
    "{",
    "}",
    ",",
    "!",
  ];
  // 通过前后字符串拼接成选择文本
  let posIndex = position.character;
  let textMeta = line.text.substr(posIndex, 1);
  let selectText = "";
  // 前向获取符合要求的字符串
  while (textSplite.indexOf(textMeta) === -1 && posIndex <= line.text.length) {
    selectText += textMeta;
    textMeta = line.text.substr(++posIndex, 1);
  }
  // 往后获取符合要求的字符串
  posIndex = position.character - 1;
  textMeta = line.text.substr(posIndex, 1);
  while (textSplite.indexOf(textMeta) === -1 && posIndex > 0) {
    selectText = textMeta + selectText;
    textMeta = line.text.substr(--posIndex, 1);
  }

  // 查找字符串位置
  let pos = 0;
  let begin = false;
  let lineText = "";
  let braceLeftCount = 0;
  let attr = "";
  // 搜索类型，主要用于判断在哪个属性中去搜索内容，目前主要用于区分是否是组件
  let searchType = "";
  // 判断选择文件搜索类型，是否是标签
  if (textMeta === "<") {
    searchType = "components";
  }
  while (pos < document.lineCount && !/^\s*<\/script>\s*$/g.test(lineText)) {
    lineText = document.lineAt(++pos).text;
    // 从script标签开始查找
    if (!begin) {
      if (/^\s*<script.*>\s*$/g.test(lineText)) {
        begin = true;
      }
      continue;
    }
    // 判断现在正在对哪个属性进行遍历
    let keyWord = lineText.replace(
      /\s*(\w*)\s*(\(\s*\)|:|(:\s*function\s*\(\s*\)))\s*{\s*/gi,
      "$1"
    );
    // braceLeftCount <= 3 用于去除data属性中包含vue其他属性从而不能定义问题
    if (this.VUE_ATTR[keyWord] !== undefined && braceLeftCount === 0) {
      attr = keyWord;
      braceLeftCount = 0;
    }

    if (searchType === "components") {
      /**
       * component组件跳转处理方式
       * 1. 文件内import，require引入判断
       * 2. iview, element组件判断
       */
      // attr存在，说明已遍历过import内容
      let tag = selectText.toLowerCase().replace(/-/gi, "");
      if (
        lineText.toLowerCase().includes(tag) &&
        (lineText.trim().indexOf("import") === 0 ||
          lineText.trim().indexOf("require") === 0)
      ) {
        return this.definitionOutFile(
          document,
          this.getDefinitionPosition(lineText)
        );
      }
    } else {
      // data属性匹配, data具有return，单独处理
      if (attr === "data" && braceLeftCount >= 2) {
        let matchName = lineText.replace(/\s*(\w+):.+/gi, "$1");
        if (selectText === matchName && braceLeftCount === 2) {
          return Promise.resolve(
            new vscode.Location(
              document.uri,
              new vscode.Position(
                pos,
                lineText.indexOf(matchName) + matchName.length
              )
            )
          );
        }
        let braceLeft = lineText.match(/{/gi)
          ? lineText.match(/{/gi).length
          : 0;
        let braceRight = lineText.match(/}/gi)
          ? lineText.match(/}/gi).length
          : 0;
        braceLeftCount += braceLeft - braceRight;
      } else if (attr) {
        let matchName = lineText.replace(
          /\s*(async\s*)?(\w*)\s*(:|\().*/gi,
          "$2"
        );
        if (selectText === matchName && braceLeftCount === 1) {
          return Promise.resolve(
            new vscode.Location(
              document.uri,
              new vscode.Position(
                pos,
                lineText.indexOf(matchName) + matchName.length
              )
            )
          );
        }
        let braceLeft = lineText.match(/{/gi)
          ? lineText.match(/{/gi).length
          : 0;
        let braceRight = lineText.match(/}/gi)
          ? lineText.match(/}/gi).length
          : 0;
        braceLeftCount += braceLeft - braceRight;
      }

      // data取return的属性值
      if (attr === "data") {
        if (/\s*return\s*{\s*/gi.test(lineText)) {
          braceLeftCount = 2;
        }
      }
    }
  }

  // 全目录搜索看是否存在该文件
  let files = glob.sync(
    vscode.workspace.rootPath + "/!(node_modules)/**/*.vue"
  );
  for (let i = 0; i < files.length; i++) {
    const vueFile = files[i];
    let vueChangeFile = vueFile
      .replace(/-/gi, "")
      .toLowerCase()
      .replace(/\.vue$/, "");
    if (
      vueChangeFile.endsWith("/" + selectText.toLowerCase().replace(/-/gi, ""))
    ) {
      return Promise.resolve(
        new vscode.Location(vscode.Uri.file(vueFile), new vscode.Position(0, 0))
      );
    }
  }

  return Promise.resolve(null);
};

vueDefinition.prototype.provideDefinition = function (
  document,
  position,
  token
) {
  const line = document.lineAt(position.line);
  return this.defineInFile(document, position, line);
};

module.exports = vueDefinition;
