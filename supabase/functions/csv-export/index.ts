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
        const { simulationData, metadata } = await req.json();

        if (!simulationData) {
            throw new Error('缺少模拟数据');
        }

        // 生成CSV内容
        const csvContent = generateCSVContent(simulationData, metadata);

        // 设置CSV文件名
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `simulation_analysis_${timestamp}.csv`;

        return new Response(csvContent, {
            headers: {
                ...corsHeaders,
                'Content-Type': 'text/csv; charset=utf-8',
                'Content-Disposition': `attachment; filename="${fileName}"`,
                'Content-Length': csvContent.length.toString()
            }
        });
    } catch (error) {
        const errorResponse = {
            error: {
                code: 'CSV_EXPORT_ERROR',
                message: error.message
            }
        };

        return new Response(JSON.stringify(errorResponse), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
});

// 生成CSV内容
function generateCSVContent(simulationData: any, metadata: any): string {
    const { model, predictions, scenarios, statistics, riskMetrics } = simulationData;
    const { analysisType, parameters, timestamp } = metadata || {};

    let csvContent = '';
    
    // CSV头部信息
    csvContent += `# 模拟分析报告\n`;
    csvContent += `# 生成时间: ${timestamp || new Date().toISOString()}\n`;
    csvContent += `# 分析类型: ${analysisType || model || 'Unknown'}\n`;
    csvContent += `# 模型参数: ${JSON.stringify(parameters || {})}\n`;
    csvContent += `\n`;

    // 1. 预测数据表
    if (predictions && Array.isArray(predictions)) {
        csvContent += `## 预测数据\n`;
        csvContent += `时间点,预测值\n`;
        
        predictions.forEach((value, index) => {
            csvContent += `${index + 1},${value.toFixed(6)}\n`;
        });
        csvContent += `\n`;
    }

    // 2. 场景分析数据
    if (scenarios && Array.isArray(scenarios)) {
        csvContent += `## 场景分析\n`;
        csvContent += `场景名称,概率,数量,描述\n`;
        
        scenarios.forEach(scenario => {
            csvContent += `"${scenario.name}",${scenario.probability?.toFixed(4) || ''},${scenario.count || ''},"${scenario.description || ''}"\n`;
        });
        csvContent += `\n`;

        // 添加每个场景的详细路径
        scenarios.forEach(scenario => {
            if (scenario.averagePath && Array.isArray(scenario.averagePath)) {
                csvContent += `## ${scenario.name} - 平均路径\n`;
                csvContent += `时间点,数值\n`;
                
                scenario.averagePath.forEach((value: number, index: number) => {
                    csvContent += `${index + 1},${value.toFixed(6)}\n`;
                });
                csvContent += `\n`;
            }
        });
    }

    // 3. 统计指标
    if (statistics) {
        csvContent += `## 统计指标\n`;
        csvContent += `指标名称,数值\n`;
        
        addStatisticsToCSV(csvContent, statistics, '');
        csvContent += `\n`;
    }

    // 4. 风险指标
    if (riskMetrics) {
        csvContent += `## 风险指标\n`;
        csvContent += `指标名称,数值,说明\n`;
        
        addRiskMetricsToCSV(csvContent, riskMetrics, '');
        csvContent += `\n`;
    }

    // 5. 百分位数数据
    if (simulationData.percentilePaths) {
        csvContent += `## 百分位数路径\n`;
        
        const percentileKeys = Object.keys(simulationData.percentilePaths);
        if (percentileKeys.length > 0) {
            // 头部
            csvContent += `时间点,${percentileKeys.join(',')},\n`;
            
            // 数据行
            const pathLength = simulationData.percentilePaths[percentileKeys[0]]?.length || 0;
            for (let i = 0; i < pathLength; i++) {
                const values = percentileKeys.map(key => {
                    const value = simulationData.percentilePaths[key][i];
                    return typeof value === 'number' ? value.toFixed(6) : '';
                });
                csvContent += `${i + 1},${values.join(',')},\n`;
            }
        }
        csvContent += `\n`;
    }

    // 6. 模型诊断信息
    if (simulationData.diagnostics) {
        csvContent += `## 模型诊断\n`;
        csvContent += `诊断项目,结果,说明\n`;
        
        addDiagnosticsToCSV(csvContent, simulationData.diagnostics, '');
        csvContent += `\n`;
    }

    // 添加时间戳和版权信息
    csvContent += `## 其他信息\n`;
    csvContent += `项目,内容\n`;
    csvContent += `生成时间,${new Date().toISOString()}\n`;
    csvContent += `版本,MiniMax 财务分析系统 v2.0\n`;
    csvContent += `数据来源,模拟分析系统\n`;

    return csvContent;
}

// 向CSV添加统计指标
function addStatisticsToCSV(csvContent: string, statistics: any, prefix: string): string {
    for (const [key, value] of Object.entries(statistics)) {
        if (typeof value === 'object' && value !== null) {
            // 递归处理嵌套对象
            csvContent += addStatisticsToCSV('', value, `${prefix}${key}.`);
        } else if (typeof value === 'number') {
            csvContent += `${prefix}${key},${value.toFixed(6)}\n`;
        } else {
            csvContent += `${prefix}${key},"${value}"\n`;
        }
    }
    return csvContent;
}

// 向CSV添加风险指标
function addRiskMetricsToCSV(csvContent: string, riskMetrics: any, prefix: string): string {
    for (const [key, value] of Object.entries(riskMetrics)) {
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            for (const [subKey, subValue] of Object.entries(value)) {
                if (subKey === 'interpretation') {
                    csvContent += `${prefix}${key}.${subKey},,"${subValue}"\n`;
                } else if (typeof subValue === 'number') {
                    csvContent += `${prefix}${key}.${subKey},${subValue.toFixed(6)},\n`;
                } else {
                    csvContent += `${prefix}${key}.${subKey},"${subValue}",\n`;
                }
            }
        } else if (typeof value === 'number') {
            csvContent += `${prefix}${key},${value.toFixed(6)},\n`;
        } else {
            csvContent += `${prefix}${key},"${value}",\n`;
        }
    }
    return csvContent;
}

// 向CSV添加诊断信息
function addDiagnosticsToCSV(csvContent: string, diagnostics: any, prefix: string): string {
    for (const [key, value] of Object.entries(diagnostics)) {
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            for (const [subKey, subValue] of Object.entries(value)) {
                if (typeof subValue === 'boolean') {
                    csvContent += `${prefix}${key}.${subKey},${subValue ? '通过' : '未通过'},\n`;
                } else if (typeof subValue === 'number') {
                    csvContent += `${prefix}${key}.${subKey},${subValue.toFixed(6)},\n`;
                } else {
                    csvContent += `${prefix}${key}.${subKey},"${subValue}",\n`;
                }
            }
        } else if (typeof value === 'boolean') {
            csvContent += `${prefix}${key},${value ? '通过' : '未通过'},\n`;
        } else if (typeof value === 'number') {
            csvContent += `${prefix}${key},${value.toFixed(6)},\n`;
        } else {
            csvContent += `${prefix}${key},"${value}",\n`;
        }
    }
    return csvContent;
}