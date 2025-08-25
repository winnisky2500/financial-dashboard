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
        const { initialValue, parameters } = await req.json();

        if (typeof initialValue !== 'number' || initialValue <= 0) {
            throw new Error('初始值必须为正数');
        }

        const {
            numSimulations = 1000,
            timeHorizon = 12,
            drift = 0.05,
            volatility = 0.15,
            exchangeRateChange = 0,
            interestRateChange = 0,
            customParams = {},
            correlations = {},
            jumpParameters = null,
            modelType = 'geometric_brownian'
        } = parameters || {};

        // 执行增强蒙特卡洛模拟
        const result = enhancedMonteCarloSimulation({
            initialValue,
            numSimulations,
            timeHorizon,
            drift,
            volatility,
            exchangeRateChange,
            interestRateChange,
            customParams,
            correlations,
            jumpParameters,
            modelType
        });

        return new Response(JSON.stringify({ data: result }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    } catch (error) {
        const errorResponse = {
            error: {
                code: 'ENHANCED_MONTE_CARLO_ERROR',
                message: error.message
            }
        };

        return new Response(JSON.stringify(errorResponse), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
});

// 增强蒙特卡洛模拟主函数
function enhancedMonteCarloSimulation(params: any) {
    const {
        initialValue, numSimulations, timeHorizon, drift, volatility,
        exchangeRateChange, interestRateChange, customParams,
        correlations, jumpParameters, modelType
    } = params;

    const allSimulations: number[][] = [];
    const scenarioData = {
        bull: { count: 0, paths: [] as number[][] },
        base: { count: 0, paths: [] as number[][] },
        bear: { count: 0, paths: [] as number[][] }
    };

    // 生成所有模拟路径
    for (let sim = 0; sim < numSimulations; sim++) {
        let path: number[];
        
        switch (modelType) {
            case 'geometric_brownian':
                path = generateGeometricBrownianPath(initialValue, drift, volatility, timeHorizon, exchangeRateChange, interestRateChange, customParams);
                break;
            case 'mean_reverting':
                path = generateMeanRevertingPath(initialValue, drift, volatility, timeHorizon);
                break;
            case 'jump_diffusion':
                path = generateJumpDiffusionPath(initialValue, drift, volatility, timeHorizon, jumpParameters);
                break;
            default:
                path = generateGeometricBrownianPath(initialValue, drift, volatility, timeHorizon, exchangeRateChange, interestRateChange, customParams);
        }
        
        allSimulations.push(path);
        
        // 分类场景
        const finalValue = path[path.length - 1];
        const totalReturn = (finalValue - initialValue) / initialValue;
        
        if (totalReturn > 0.1) {
            scenarioData.bull.count++;
            if (scenarioData.bull.paths.length < 10) {
                scenarioData.bull.paths.push(path);
            }
        } else if (totalReturn < -0.1) {
            scenarioData.bear.count++;
            if (scenarioData.bear.paths.length < 10) {
                scenarioData.bear.paths.push(path);
            }
        } else {
            scenarioData.base.count++;
            if (scenarioData.base.paths.length < 10) {
                scenarioData.base.paths.push(path);
            }
        }
    }

    // 计算百分位数路径
    const percentilePaths = calculatePercentilePaths(allSimulations, timeHorizon);
    
    // 计算统计指标
    const statistics = calculateEnhancedStatistics(allSimulations);
    
    // 风险度量
    const riskMetrics = calculateRiskMetrics(allSimulations, initialValue);
    
    // 情景分析
    const scenarioAnalysis = {
        scenarios: [
            {
                name: '牛市情景 (>10%收益)',
                probability: scenarioData.bull.count / numSimulations,
                count: scenarioData.bull.count,
                averagePath: calculateAveragePath(scenarioData.bull.paths),
                description: '市场表现强劲，收益超过10%'
            },
            {
                name: '基准情景 (-10%~10%)',
                probability: scenarioData.base.count / numSimulations,
                count: scenarioData.base.count,
                averagePath: calculateAveragePath(scenarioData.base.paths),
                description: '市场表现平稳，收益在正负10%之间'
            },
            {
                name: '熊市情景 (<-10%损失)',
                probability: scenarioData.bear.count / numSimulations,
                count: scenarioData.bear.count,
                averagePath: calculateAveragePath(scenarioData.bear.paths),
                description: '市场表现疲软，损失超过10%'
            }
        ]
    };
    
    // 敏感性分析
    const sensitivityAnalysis = performSensitivityAnalysis(params);
    
    return {
        model: 'Enhanced-Monte-Carlo',
        modelType,
        simulations: allSimulations.slice(0, 20), // 只返回前20条路径用于图表显示
        percentilePaths,
        statistics,
        riskMetrics,
        scenarioAnalysis,
        sensitivityAnalysis,
        parameters: {
            numSimulations,
            timeHorizon,
            drift,
            volatility,
            initialValue
        },
        externalFactors: {
            exchangeRateImpact: exchangeRateChange,
            interestRateImpact: interestRateChange,
            customFactorsCount: Object.keys(customParams).length
        }
    };
}

// 几何布朗运动路径生成
function generateGeometricBrownianPath(
    initialValue: number,
    drift: number,
    volatility: number,
    timeHorizon: number,
    exchangeRateChange: number = 0,
    interestRateChange: number = 0,
    customParams: any = {}
): number[] {
    const path: number[] = [initialValue];
    const dt = 1 / 12; // 月度间隔
    
    for (let i = 1; i <= timeHorizon; i++) {
        const random1 = Math.random();
        const random2 = Math.random();
        const normalRandom = Math.sqrt(-2 * Math.log(random1)) * Math.cos(2 * Math.PI * random2);
        
        // 基础几何布朗运动
        let adjustedDrift = drift;
        let adjustedVolatility = volatility;
        
        // 应用外部因素影响
        adjustedDrift += exchangeRateChange * 0.3 * (i / timeHorizon);
        adjustedDrift -= interestRateChange * 0.5 * (i / timeHorizon);
        
        // 自定义参数影响
        for (const [key, value] of Object.entries(customParams)) {
            if (typeof value === 'number') {
                adjustedDrift += value * 0.1 * (i / timeHorizon);
            }
        }
        
        // 时间衰减的波动率
        adjustedVolatility *= (1 + 0.1 * Math.sin(2 * Math.PI * i / 12));
        
        const shock = adjustedVolatility * normalRandom * Math.sqrt(dt);
        const nextValue = path[i - 1] * Math.exp((adjustedDrift - 0.5 * adjustedVolatility * adjustedVolatility) * dt + shock);
        
        path.push(Math.max(0, nextValue));
    }
    
    return path;
}

// 均值回归路径生成
function generateMeanRevertingPath(
    initialValue: number,
    longTermMean: number,
    volatility: number,
    timeHorizon: number,
    meanReversion: number = 0.5
): number[] {
    const path: number[] = [initialValue];
    const dt = 1 / 12;
    
    for (let i = 1; i <= timeHorizon; i++) {
        const random1 = Math.random();
        const random2 = Math.random();
        const normalRandom = Math.sqrt(-2 * Math.log(random1)) * Math.cos(2 * Math.PI * random2);
        
        const currentValue = path[i - 1];
        const drift = meanReversion * (longTermMean - currentValue);
        const shock = volatility * normalRandom * Math.sqrt(dt);
        
        const nextValue = currentValue + drift * dt + shock;
        path.push(Math.max(0, nextValue));
    }
    
    return path;
}

// 跳跃扩散路径生成
function generateJumpDiffusionPath(
    initialValue: number,
    drift: number,
    volatility: number,
    timeHorizon: number,
    jumpParams: any
): number[] {
    const path: number[] = [initialValue];
    const dt = 1 / 12;
    const { jumpIntensity = 0.1, jumpMean = 0, jumpStd = 0.1 } = jumpParams || {};
    
    for (let i = 1; i <= timeHorizon; i++) {
        const random1 = Math.random();
        const random2 = Math.random();
        const normalRandom = Math.sqrt(-2 * Math.log(random1)) * Math.cos(2 * Math.PI * random2);
        
        // 正常扩散部分
        const diffusionShock = volatility * normalRandom * Math.sqrt(dt);
        let nextValue = path[i - 1] * Math.exp((drift - 0.5 * volatility * volatility) * dt + diffusionShock);
        
        // 跳跃部分
        if (Math.random() < jumpIntensity * dt) {
            const jumpRandom1 = Math.random();
            const jumpRandom2 = Math.random();
            const jumpNormalRandom = Math.sqrt(-2 * Math.log(jumpRandom1)) * Math.cos(2 * Math.PI * jumpRandom2);
            const jumpSize = Math.exp(jumpMean + jumpStd * jumpNormalRandom);
            nextValue *= jumpSize;
        }
        
        path.push(Math.max(0, nextValue));
    }
    
    return path;
}

// 计算百分位数路径
function calculatePercentilePaths(allSimulations: number[][], timeHorizon: number) {
    const percentiles = [0.05, 0.25, 0.5, 0.75, 0.95];
    const percentileNames = ['p5', 'p25', 'p50', 'p75', 'p95'];
    const paths: any = {};
    
    percentileNames.forEach(name => {
        paths[name] = [];
    });
    
    for (let period = 0; period <= timeHorizon; period++) {
        const periodValues = allSimulations.map(sim => sim[period]).sort((a, b) => a - b);
        
        percentiles.forEach((percentile, index) => {
            const percentileName = percentileNames[index];
            const value = periodValues[Math.floor(periodValues.length * percentile)];
            paths[percentileName].push(value);
        });
    }
    
    return paths;
}

// 计算增强统计指标
function calculateEnhancedStatistics(allSimulations: number[][]) {
    const finalValues = allSimulations.map(sim => sim[sim.length - 1]).sort((a, b) => a - b);
    const mean = finalValues.reduce((sum, val) => sum + val, 0) / finalValues.length;
    const variance = finalValues.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / finalValues.length;
    const stdDev = Math.sqrt(variance);
    
    return {
        finalValues: {
            mean,
            median: finalValues[Math.floor(finalValues.length * 0.5)],
            standardDeviation: stdDev,
            variance,
            min: Math.min(...finalValues),
            max: Math.max(...finalValues),
            range: Math.max(...finalValues) - Math.min(...finalValues),
            coefficientOfVariation: stdDev / mean
        },
        distribution: {
            skewness: calculateSkewness(finalValues),
            kurtosis: calculateKurtosis(finalValues),
            percentiles: {
                p1: finalValues[Math.floor(finalValues.length * 0.01)],
                p5: finalValues[Math.floor(finalValues.length * 0.05)],
                p10: finalValues[Math.floor(finalValues.length * 0.10)],
                p25: finalValues[Math.floor(finalValues.length * 0.25)],
                p75: finalValues[Math.floor(finalValues.length * 0.75)],
                p90: finalValues[Math.floor(finalValues.length * 0.90)],
                p95: finalValues[Math.floor(finalValues.length * 0.95)],
                p99: finalValues[Math.floor(finalValues.length * 0.99)]
            }
        }
    };
}

// 计算风险度量
function calculateRiskMetrics(allSimulations: number[][], initialValue: number) {
    const finalValues = allSimulations.map(sim => sim[sim.length - 1]);
    const returns = finalValues.map(val => (val - initialValue) / initialValue);
    const sortedReturns = returns.sort((a, b) => a - b);
    
    // Value at Risk (VaR)
    const var95 = sortedReturns[Math.floor(sortedReturns.length * 0.05)];
    const var99 = sortedReturns[Math.floor(sortedReturns.length * 0.01)];
    
    // Conditional Value at Risk (CVaR)
    const cvar95 = sortedReturns.slice(0, Math.floor(sortedReturns.length * 0.05))
        .reduce((sum, val) => sum + val, 0) / Math.floor(sortedReturns.length * 0.05);
    
    // Maximum Drawdown
    const maxDrawdowns = allSimulations.map(sim => calculateMaxDrawdown(sim));
    const avgMaxDrawdown = maxDrawdowns.reduce((sum, val) => sum + val, 0) / maxDrawdowns.length;
    const worstDrawdown = Math.min(...maxDrawdowns);
    
    // Probability of Loss
    const lossCount = returns.filter(ret => ret < 0).length;
    const probOfLoss = lossCount / returns.length;
    
    return {
        valueAtRisk: {
            var95: var95 * 100, // 转换为百分比
            var99: var99 * 100,
            interpretation: 'Value at Risk表示在95%/99%置信度下的最大可能损失'
        },
        conditionalValueAtRisk: {
            cvar95: cvar95 * 100,
            interpretation: 'CVaR表示在最坏5%情况下的平均损失'
        },
        drawdownAnalysis: {
            averageMaxDrawdown: avgMaxDrawdown * 100,
            worstCaseDrawdown: worstDrawdown * 100,
            interpretation: 'Maximum Drawdown表示从峰值到谷值的最大跌幅'
        },
        probabilityMetrics: {
            probabilityOfLoss: probOfLoss * 100,
            probabilityOfGain: (1 - probOfLoss) * 100,
            expectedReturn: returns.reduce((sum, val) => sum + val, 0) / returns.length * 100
        }
    };
}

// 计算最大回撤
function calculateMaxDrawdown(path: number[]): number {
    let maxDrawdown = 0;
    let peak = path[0];
    
    for (let i = 1; i < path.length; i++) {
        if (path[i] > peak) {
            peak = path[i];
        } else {
            const drawdown = (peak - path[i]) / peak;
            maxDrawdown = Math.max(maxDrawdown, drawdown);
        }
    }
    
    return -maxDrawdown; // 返回负值表示损失
}

// 敏感性分析
function performSensitivityAnalysis(baseParams: any) {
    const sensitivityResults = [];
    const variations = [-0.5, -0.25, 0, 0.25, 0.5];
    
    // 漂移率敏感性
    for (const variation of variations) {
        const adjustedParams = { ...baseParams, drift: baseParams.drift * (1 + variation) };
        const quickSim = generateGeometricBrownianPath(
            adjustedParams.initialValue,
            adjustedParams.drift,
            adjustedParams.volatility,
            adjustedParams.timeHorizon
        );
        const finalValue = quickSim[quickSim.length - 1];
        
        sensitivityResults.push({
            parameter: 'drift',
            variation: variation * 100,
            finalValue,
            impact: (finalValue - baseParams.initialValue) / baseParams.initialValue * 100
        });
    }
    
    return {
        driftSensitivity: sensitivityResults,
        interpretation: '敏感性分析显示参数变化对最终结果的影响程度'
    };
}

// 计算平均路径
function calculateAveragePath(paths: number[][]): number[] {
    if (paths.length === 0) return [];
    
    const avgPath: number[] = [];
    const pathLength = paths[0].length;
    
    for (let i = 0; i < pathLength; i++) {
        const sum = paths.reduce((total, path) => total + (path[i] || 0), 0);
        avgPath.push(sum / paths.length);
    }
    
    return avgPath;
}

// 辅助函数：计算偏度
function calculateSkewness(data: number[]): number {
    const mean = data.reduce((sum, val) => sum + val, 0) / data.length;
    const variance = data.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / (data.length - 1);
    const stdDev = Math.sqrt(variance);
    
    const skewness = data.reduce((sum, val) => {
        return sum + Math.pow((val - mean) / stdDev, 3);
    }, 0) / data.length;
    
    return skewness;
}

// 辅助函数：计算峰度
function calculateKurtosis(data: number[]): number {
    const mean = data.reduce((sum, val) => sum + val, 0) / data.length;
    const variance = data.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / (data.length - 1);
    const stdDev = Math.sqrt(variance);
    
    const kurtosis = data.reduce((sum, val) => {
        return sum + Math.pow((val - mean) / stdDev, 4);
    }, 0) / data.length;
    
    return kurtosis - 3; // 超额峰度
}