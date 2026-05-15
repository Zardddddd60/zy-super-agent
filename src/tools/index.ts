
import { editFileTool, listDirectoryTool, readFileTool, writeFileTool } from './file-tools';
import { ToolDefinition } from './registry';
import { globTool, grepTool } from './search-tools';
import { bashTool } from './shell-tools';
import { calculatorTool, weatherTool } from './utility-tools';
import { pickSearchTool, webFetchTool } from './web-search';

export const allTools: ToolDefinition[] = [
  weatherTool,
  calculatorTool,
  readFileTool,
  writeFileTool,
  listDirectoryTool,
  editFileTool,
  globTool,
  grepTool,
  bashTool,
  pickSearchTool(),
  webFetchTool,
];

export {
  weatherTool, calculatorTool,
  readFileTool, writeFileTool, editFileTool, listDirectoryTool,
  globTool, grepTool,
  bashTool,
};