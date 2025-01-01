// Logger Class Definition
class LaunchPadLogger {
  constructor() {
    this.isNode = typeof process !== "undefined" && process.versions != null && process.versions.node != null;
    this.verbose = this.isNode ? process.env.verbose === "true" : false;
    this.closeByNewLine = true;
    this.useIcons = true;

    // Titles for different log types
    this.logsTitle = "LOGS";
    this.warningsTitle = "WARNINGS";
    this.errorsTitle = "ERRORS";
    this.informationsTitle = "INFORMATIONS";
    this.successesTitle = "SUCCESS";
    this.debugsTitle = "DEBUG";
    this.assertsTitle = "ASSERT";
  }

  #getColor(foregroundColor = "", backgroundColor = "") {
    if (!this.isNode) {
      // Browser color mapping
      const colors = {
        black: "#000000",
        red: "#ff0000",
        green: "#00ff00",
        yellow: "#ffff00",
        blue: "#0000ff",
        magenta: "#ff00ff",
        cyan: "#00ffff",
        white: "#ffffff",
      };
      const fg = colors[foregroundColor.toLowerCase()] || colors.white;
      const bg = colors[backgroundColor.toLowerCase()] || "transparent";
      return `color: ${fg}; background: ${bg};`;
    }

    // Node.js color codes
    const colorCodes = {
      black: "\x1B[30m",
      red: "\x1B[31m",
      green: "\x1B[32m",
      yellow: "\x1B[33m",
      blue: "\x1B[34m",
      magenta: "\x1B[35m",
      cyan: "\x1B[36m",
      white: "\x1B[37m",
    };
    const bgColorCodes = {
      black: "\x1B[40m",
      red: "\x1B[41m",
      green: "\x1B[42m",
      yellow: "\x1B[43m",
      blue: "\x1B[44m",
      magenta: "\x1B[45m",
      cyan: "\x1B[46m",
      white: "\x1B[47m",
    };
    const fg = colorCodes[foregroundColor.toLowerCase()] || colorCodes.white;
    const bg = bgColorCodes[backgroundColor.toLowerCase()] || "";
    return `${fg}${bg}`;
  }

  #getColorReset() {
    return this.isNode ? "\x1B[0m" : "";
  }

  clear() {
    console.clear();
  }

  print(foregroundColor = "white", backgroundColor = "black", ...strings) {
    const formattedStrings = strings.map((item) =>
      typeof item === "object"
        ? JSON.stringify(item, (key, value) => (typeof value === "bigint" ? value.toString() : value))
        : item
    );
    if (this.isNode) {
      const color = this.#getColor(foregroundColor, backgroundColor);
      console.log(color, formattedStrings.join(" "), this.#getColorReset());
    } else {
      const style = this.#getColor(foregroundColor, backgroundColor);
      console.log(`%c${formattedStrings.join(" ")}`, style);
    }
    if (this.closeByNewLine) console.log("");
  }

  #logWithStyle(strings, options) {
    const { fg, bg, icon, groupTitle } = options;
    if (strings.length > 1) {
      if (this.isNode) {
        const color = this.#getColor(fg, bg);
        console.group(color, (this.useIcons ? icon : "") + groupTitle);
      } else {
        const style = this.#getColor(fg, bg);
        console.group(`%c${this.useIcons ? icon : ""}${groupTitle}`, style);
      }
      const originalCloseByNewLine = this.closeByNewLine;
      this.closeByNewLine = false;
      strings.forEach((item) => this.print(fg, bg, item));
      this.closeByNewLine = originalCloseByNewLine;
      console.groupEnd();
      if (originalCloseByNewLine) console.log("");
    } else {
      this.print(
        fg,
        bg,
        strings.map((item) => `${this.useIcons ? `${icon} ` : ""}${item}`)
      );
    }
  }

  log(...strings) {
    this.#logWithStyle(strings, {
      fg: "white",
      bg: "",
      icon: "\u25CE",
      groupTitle: ` ${this.logsTitle}`,
    });
  }

  warn(...strings) {
    this.#logWithStyle(strings, {
      fg: "yellow",
      bg: "",
      icon: "\u26A0",
      groupTitle: ` ${this.warningsTitle}`,
    });
  }

  error(...strings) {
    this.#logWithStyle(strings, {
      fg: "red",
      bg: "",
      icon: "\u26D4",
      groupTitle: ` ${this.errorsTitle}`,
    });
  }

  info(...strings) {
    this.#logWithStyle(strings, {
      fg: "blue",
      bg: "",
      icon: "\u2139",
      groupTitle: ` ${this.informationsTitle}`,
    });
  }

  success(...strings) {
    this.#logWithStyle(strings, {
      fg: "green",
      bg: "",
      icon: "\u2713",
      groupTitle: ` ${this.successesTitle}`,
    });
  }

  debug(...strings) {
    if (!this.verbose) return;
    this.#logWithStyle(strings, {
      fg: "magenta",
      bg: "",
      icon: "\u1367",
      groupTitle: ` ${this.debugsTitle}`,
    });
  }

  assert(...strings) {
    this.#logWithStyle(strings, {
      fg: "cyan",
      bg: "",
      icon: "!",
      groupTitle: ` ${this.assertsTitle}`,
    });
  }
}

// Logger Instance
const launchPadLogger = new LaunchPadLogger();
launchPadLogger.clear();
launchPadLogger.useIcons = true; // Enable or disable icons
launchPadLogger.closeByNewLine = true;

// Exports
module.exports = { launchPadLogger };
