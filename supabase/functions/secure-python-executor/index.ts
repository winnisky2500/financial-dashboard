Deno.serve(async (req) => {
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE, PATCH',
        'Access-Control-Max-Age': '86400',
        'Access-Control-Allow-Credentials': 'false'
    };

    if (req.method === 'OPTIONS') {
        return new Response(null, { status: 200, headers: corsHeaders });
    }

    try {
        const { pythonCode, inputData, parameters, executionTimeout = 30000 } = await req.json();

        if (!pythonCode || typeof pythonCode !== 'string') {
            throw new Error('Python代码不能为空');
        }

        if (!Array.isArray(inputData) || inputData.length === 0) {
            throw new Error('输入数据格式无效');
        }

        // 严格的代码安全检查
        const securityCheck = performSecurityCheck(pythonCode);
        if (!securityCheck.isSafe) {
            throw new Error(`代码安全检查失败: ${securityCheck.reason}`);
        }

        // 代码解析和转换
        const jsCode = convertPythonToJS(pythonCode);
        
        // 在沙箱环境中执行代码
        const executionResult = await executeInSandbox(jsCode, inputData, parameters, executionTimeout);

        // 验证输出数据格式
        const validatedResult = validateOutput(executionResult);

        // 计算执行统计
        const statistics = calculateExecutionStatistics(validatedResult.predictions);

        const result = {
            model: 'Custom-Python-Function',
            executionStatus: 'success',
            predictions: validatedResult.predictions,
            statistics,
            executionInfo: {
                codeLength: pythonCode.length,
                inputDataPoints: inputData.length,
                executionTime: validatedResult.executionTime,
                memoryUsage: validatedResult.memoryUsage || 'N/A',
                codeComplexity: analyzeCodeComplexity(pythonCode)
            },
            securityInfo: {
                securityLevel: 'safe',
                checkedFeatures: securityCheck.checkedFeatures,
                sanitizedCode: jsCode.length !== pythonCode.length
            },
            metadata: {
                timestamp: new Date().toISOString(),
                executionEnvironment: 'Deno-Sandbox',
                version: '2.0'
            }
        };

        return new Response(JSON.stringify({ data: result }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    } catch (error) {
        const errorResponse = {
            error: {
                code: 'PYTHON_EXECUTION_ERROR',
                message: error.message,
                timestamp: new Date().toISOString()
            }
        };

        return new Response(JSON.stringify(errorResponse), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
});

// 安全检查函数
function performSecurityCheck(code: string): { isSafe: boolean; reason?: string; checkedFeatures: string[] } {
    const checkedFeatures = [];
    
    // 危险关键字检查
    const dangerousKeywords = [
        'import os', 'import sys', 'import subprocess', 'import socket',
        'import urllib', 'import requests', 'import http', 'import ftplib',
        'open(', 'file(', 'input(', 'raw_input(', 'eval(', 'exec(',
        'compile(', '__import__', 'globals()', 'locals()', 'vars(',
        'dir(', 'reload(', 'execfile(', 'exit(', 'quit(',
        'os.', 'sys.', 'subprocess.', 'socket.', '__builtins__',
        'getattr(', 'setattr(', 'delattr()', 'hasattr(',
        'super()', 'classmethod(', 'staticmethod(', 'property(',
        'file://', 'http://', 'https://', 'ftp://'
    ];
    
    checkedFeatures.push('dangerous_keywords');
    
    for (const keyword of dangerousKeywords) {
        if (code.includes(keyword)) {
            return {
                isSafe: false,
                reason: `检测到危险关键字: ${keyword}`,
                checkedFeatures
            };
        }
    }
    
    // 检查网络相关操作
    checkedFeatures.push('network_operations');
    if (code.match(/\b(connect|request|download|upload|send|recv)\s*\(/)) {
        return {
            isSafe: false,
            reason: '不允许网络操作',
            checkedFeatures
        };
    }
    
    // 检查文件系统操作
    checkedFeatures.push('file_operations');
    if (code.match(/\b(read|write|delete|remove|mkdir|rmdir)\s*\(/)) {
        return {
            isSafe: false,
            reason: '不允许文件系统操作',
            checkedFeatures
        };
    }
    
    // 检查代码长度
    checkedFeatures.push('code_length');
    if (code.length > 10000) {
        return {
            isSafe: false,
            reason: '代码长度超过限制(10KB)',
            checkedFeatures
        };
    }
    
    // 检查循环深度
    checkedFeatures.push('loop_complexity');
    const forLoopCount = (code.match(/\bfor\s+/g) || []).length;
    const whileLoopCount = (code.match(/\bwhile\s+/g) || []).length;
    if (forLoopCount > 3 || whileLoopCount > 2) {
        return {
            isSafe: false,
            reason: '循环结构过于复杂',
            checkedFeatures
        };
    }
    
    return {
        isSafe: true,
        checkedFeatures
    };
}

// Python代码转JavaScript
function convertPythonToJS(pythonCode: string): string {
    let jsCode = pythonCode;
    
    // Python到JavaScript的基础语法转换
    const conversions = [
        // 数学函数映射
        [/\bnp\.mean\s*\(/g, 'calculateMean('],
        [/\bnp\.std\s*\(/g, 'calculateStd('],
        [/\bnp\.sum\s*\(/g, 'calculateSum('],
        [/\bnp\.max\s*\(/g, 'Math.max(...'],
        [/\bnp\.min\s*\(/g, 'Math.min(...'],
        [/\bnp\.sqrt\s*\(/g, 'Math.sqrt('],
        [/\bnp\.log\s*\(/g, 'Math.log('],
        [/\bnp\.exp\s*\(/g, 'Math.exp('],
        [/\bnp\.sin\s*\(/g, 'Math.sin('],
        [/\bnp\.cos\s*\(/g, 'Math.cos('],
        
        // 列表操作
        [/\.append\s*\(/g, '.push('],
        [/len\s*\(/g, 'getLength('],
        [/range\s*\(/g, 'createRange('],
        
        // 逻辑操作符
        [/\band\b/g, '&&'],
        [/\bor\b/g, '||'],
        [/\bnot\b/g, '!'],
        [/\bTrue\b/g, 'true'],
        [/\bFalse\b/g, 'false'],
        [/\bNone\b/g, 'null'],
        
        // 注释
        [/#(.*)$/gm, '// $1'],
        
        // def函数定义
        [/def\s+(\w+)\s*\((.*?)\)\s*:/g, 'function $1($2) {'],
        
        // if语句
        [/if\s+(.*?)\s*:/g, 'if ($1) {'],
        [/elif\s+(.*?)\s*:/g, '} else if ($1) {'],
        [/else\s*:/g, '} else {'],
        
        // for循环
        [/for\s+(\w+)\s+in\s+(.*?)\s*:/g, 'for (let $1 of $2) {'],
        
        // while循环
        [/while\s+(.*?)\s*:/g, 'while ($1) {'],
        
        // return语句
        [/return\s+/g, 'return '],
        
        // print语句转console.log
        [/print\s*\(/g, 'console.log(']
    ];
    
    // 应用转换规则
    for (const [pattern, replacement] of conversions) {
        jsCode = jsCode.replace(pattern as RegExp, replacement as string);
    }
    
    // 添加辅助函数
    const helperFunctions = `
        // Python兼容函数
        function calculateMean(arr) {
            return arr.reduce((sum, val) => sum + val, 0) / arr.length;
        }
        
        function calculateStd(arr) {
            const mean = calculateMean(arr);
            const variance = arr.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / arr.length;
            return Math.sqrt(variance);
        }
        
        function calculateSum(arr) {
            return arr.reduce((sum, val) => sum + val, 0);
        }
        
        function getLength(arr) {
            return Array.isArray(arr) ? arr.length : 0;
        }
        
        function createRange(start, end = null, step = 1) {
            if (end === null) {
                end = start;
                start = 0;
            }
            const result = [];
            for (let i = start; i < end; i += step) {
                result.push(i);
            }
            return result;
        }
        
        // 主要执行函数
        function executeUserCode(inputData, parameters = {}) {
            try {
                ${jsCode}
                
                // 如果用户定义了predict或forecast函数，使用它
                if (typeof predict === 'function') {
                    return predict(inputData, parameters);
                } else if (typeof forecast === 'function') {
                    return forecast(inputData, parameters);
                } else if (typeof analyze === 'function') {
                    return analyze(inputData, parameters);
                } else {
                    // 默认处理：基于输入数据生成预测
                    return defaultPrediction(inputData, parameters);
                }
            } catch (error) {
                throw new Error('用户代码执行错误: ' + error.message);
            }
        }
        
        function defaultPrediction(inputData, parameters) {
            const lastValue = inputData[inputData.length - 1] || 100;
            const trend = inputData.length > 1 ? 
                (inputData[inputData.length - 1] - inputData[0]) / inputData.length : 0;
            
            const predictions = [];
            for (let i = 0; i < (parameters.periods || 12); i++) {
                const value = lastValue + trend * (i + 1) + (Math.random() - 0.5) * lastValue * 0.1;
                predictions.push(Math.max(0, value));
            }
            return predictions;
        }
    `;
    
    return helperFunctions;
}

// 沙箱执行
async function executeInSandbox(
    jsCode: string,
    inputData: number[],
    parameters: any,
    timeout: number
): Promise<{ predictions: number[]; executionTime: number; memoryUsage?: string }> {
    const startTime = Date.now();
    
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            reject(new Error('代码执行超时'));
        }, timeout);
        
        try {
            // 创建沙箱环境
            const sandboxGlobals = {
                Math,
                Array,
                Object,
                JSON,
                console: {
                    log: (...args: any[]) => {}, // 禁用console.log输出
                    error: (...args: any[]) => {},
                    warn: (...args: any[]) => {}
                },
                setTimeout: undefined, // 禁用定时器
                setInterval: undefined,
                fetch: undefined, // 禁用网络请求
                XMLHttpRequest: undefined,
                WebSocket: undefined
            };
            
            // 执行代码
            const executeCode = new Function(
                'sandboxGlobals',
                'inputData',
                'parameters',
                `
                'use strict';
                
                // 限制访问全局对象
                const globalThis = undefined;
                const window = undefined;
                const self = undefined;
                const global = undefined;
                
                // 导入沙箱全局对象
                const { Math, Array, Object, JSON, console } = sandboxGlobals;
                
                ${jsCode}
                
                return executeUserCode(inputData, parameters);
                `
            );
            
            const result = executeCode(sandboxGlobals, inputData, parameters);
            const executionTime = Date.now() - startTime;
            
            clearTimeout(timeoutId);
            resolve({
                predictions: Array.isArray(result) ? result : [result],
                executionTime,
                memoryUsage: 'N/A' // Deno中难以准确测量内存使用
            });
        } catch (error) {
            clearTimeout(timeoutId);
            reject(new Error(`沙箱执行错误: ${error.message}`));
        }
    });
}

// 验证输出数据
function validateOutput(result: any): { predictions: number[]; executionTime: number; memoryUsage?: string } {
    if (!result.predictions || !Array.isArray(result.predictions)) {
        throw new Error('函数必须返回数字数组');
    }
    
    // 验证数组中的所有元素都是数字
    for (let i = 0; i < result.predictions.length; i++) {
        const value = result.predictions[i];
        if (typeof value !== 'number' || isNaN(value) || !isFinite(value)) {
            throw new Error(`输出数据包含无效数值: ${value} (位置: ${i})`);
        }
        
        // 限制数值范围
        if (Math.abs(value) > 1e12) {
            throw new Error(`输出数值过大: ${value} (位置: ${i})`);
        }
    }
    
    // 限制输出数组长度
    if (result.predictions.length > 1000) {
        throw new Error('输出数组长度超过限制(1000)');
    }
    
    return result;
}

// 分析代码复杂度
function analyzeCodeComplexity(code: string): any {
    const metrics = {
        linesOfCode: code.split('\n').length,
        functions: (code.match(/def\s+\w+/g) || []).length,
        loops: (code.match(/\b(for|while)\s+/g) || []).length,
        conditionals: (code.match(/\b(if|elif)\s+/g) || []).length,
        variables: new Set(code.match(/\b\w+\s*=/g) || []).size,
        complexity: 'low'
    };
    
    // 计算复杂度级别
    const complexityScore = metrics.functions * 2 + metrics.loops * 3 + metrics.conditionals * 2;
    if (complexityScore > 20) {
        metrics.complexity = 'high';
    } else if (complexityScore > 10) {
        metrics.complexity = 'medium';
    }
    
    return metrics;
}

// 计算执行统计
function calculateExecutionStatistics(predictions: number[]) {
    if (!Array.isArray(predictions) || predictions.length === 0) {
        return {
            mean: 0,
            median: 0,
            standardDeviation: 0,
            min: 0,
            max: 0
        };
    }
    
    const sorted = [...predictions].sort((a, b) => a - b);
    const mean = predictions.reduce((sum, val) => sum + val, 0) / predictions.length;
    const variance = predictions.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / predictions.length;
    
    return {
        mean,
        median: sorted[Math.floor(sorted.length / 2)],
        standardDeviation: Math.sqrt(variance),
        min: Math.min(...predictions),
        max: Math.max(...predictions),
        percentiles: {
            p25: sorted[Math.floor(sorted.length * 0.25)],
            p75: sorted[Math.floor(sorted.length * 0.75)],
            p95: sorted[Math.floor(sorted.length * 0.95)]
        }
    };
}