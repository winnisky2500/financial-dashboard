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
        const { historicalData, parameters } = await req.json();

        if (!Array.isArray(historicalData) || historicalData.length < 3) {
            throw new Error('历史数据至少需要3个数据点');
        }

        const {
            periods = 12,
            p = 1,
            d = 1,
            q = 1,
            exchangeRateChange = 0,
            interestRateChange = 0,
            customParams = {}
        } = parameters || {};

        // 增强的ARIMA分析算法
        const arimaResult = enhancedARIMAAnalysis(historicalData, {
            p, d, q, periods,
            exchangeRateChange,
            interestRateChange,
            customParams
        });

        return new Response(JSON.stringify({ data: arimaResult }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    } catch (error) {
        const errorResponse = {
            error: {
                code: 'ENHANCED_ARIMA_ERROR',
                message: error.message
            }
        };

        return new Response(JSON.stringify(errorResponse), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
});

// 增强的ARIMA分析函数
function enhancedARIMAAnalysis(data: number[], params: any) {
    const { p, d, q, periods, exchangeRateChange, interestRateChange, customParams } = params;
    
    // 数据预处理 - 差分
    const diffData = applyDifferencing(data, d);
    
    // 计算自相关和偏自相关系数
    const autoCorr = calculateAutoCorrelation(diffData, Math.min(10, Math.floor(data.length / 3)));
    const partialAutoCorr = calculatePartialAutoCorrelation(diffData, Math.min(10, Math.floor(data.length / 3)));
    
    // 估计ARIMA模型参数
    const arParams = estimateARParameters(diffData, p);
    const maParams = estimateMAParameters(diffData, q);
    
    // 生成基础预测
    const basePredictions = generateARIMAPredictions(data, arParams, maParams, periods, d);
    
    // 应用外部因素调整
    const adjustedPredictions = applyExternalFactors(basePredictions, {
        exchangeRateChange,
        interestRateChange,
        customParams
    });
    
    // 计算置信区间
    const residuals = calculateResiduals(data, arParams, maParams);
    const sigma = calculateStandardDeviation(residuals);
    const confidenceIntervals = calculateConfidenceIntervals(adjustedPredictions, sigma);
    
    // 模型诊断
    const diagnostics = performModelDiagnostics(residuals, autoCorr, partialAutoCorr);
    
    // 计算统计指标
    const statistics = calculateStatistics(adjustedPredictions);
    
    return {
        model: 'Enhanced-ARIMA',
        modelOrder: { p, d, q },
        predictions: adjustedPredictions,
        confidenceIntervals,
        statistics,
        diagnostics,
        parameters: {
            arCoeffs: arParams,
            maCoeffs: maParams,
            residualStdDev: sigma
        },
        modelFit: {
            aic: calculateAIC(data, arParams, maParams, residuals),
            bic: calculateBIC(data, arParams, maParams, residuals),
            rsquared: calculateRSquared(data, residuals)
        },
        externalFactors: {
            exchangeRateImpact: exchangeRateChange * 0.3,
            interestRateImpact: interestRateChange * 0.5,
            customFactorsApplied: Object.keys(customParams).length
        }
    };
}

// 差分函数
function applyDifferencing(data: number[], d: number): number[] {
    let diffData = [...data];
    for (let i = 0; i < d; i++) {
        diffData = diffData.slice(1).map((val, idx) => val - diffData[idx]);
    }
    return diffData;
}

// 计算自相关系数
function calculateAutoCorrelation(data: number[], lags: number): number[] {
    const mean = data.reduce((sum, val) => sum + val, 0) / data.length;
    const variance = data.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / data.length;
    
    const correlations: number[] = [];
    for (let lag = 1; lag <= lags; lag++) {
        let covariance = 0;
        for (let i = lag; i < data.length; i++) {
            covariance += (data[i] - mean) * (data[i - lag] - mean);
        }
        covariance /= (data.length - lag);
        correlations.push(covariance / variance);
    }
    
    return correlations;
}

// 计算偏自相关系数
function calculatePartialAutoCorrelation(data: number[], lags: number): number[] {
    const partialCorr: number[] = [];
    const autoCorr = calculateAutoCorrelation(data, lags);
    
    for (let k = 1; k <= lags; k++) {
        if (k === 1) {
            partialCorr.push(autoCorr[0]);
        } else {
            // Yule-Walker方程求解偏自相关
            const phi = solveYuleWalker(autoCorr.slice(0, k));
            partialCorr.push(phi[k - 1]);
        }
    }
    
    return partialCorr;
}

// Yule-Walker方程求解
function solveYuleWalker(autoCorr: number[]): number[] {
    const n = autoCorr.length;
    if (n === 1) return [autoCorr[0]];
    
    // 构建Toeplitz矩阵并求解（简化版）
    const phi: number[] = new Array(n).fill(0);
    phi[0] = autoCorr[0];
    
    for (let i = 1; i < n; i++) {
        let numerator = autoCorr[i];
        let denominator = 1;
        
        for (let j = 0; j < i; j++) {
            numerator -= phi[j] * autoCorr[Math.abs(i - j - 1)];
        }
        
        phi[i] = numerator / denominator;
    }
    
    return phi;
}

// 估计AR参数
function estimateARParameters(data: number[], p: number): number[] {
    if (p === 0) return [];
    
    const autoCorr = calculateAutoCorrelation(data, p);
    return solveYuleWalker(autoCorr);
}

// 估计MA参数
function estimateMAParameters(data: number[], q: number): number[] {
    if (q === 0) return [];
    
    // 简化的MA参数估计
    return new Array(q).fill(0.1).map((_, i) => 0.1 * Math.pow(0.8, i));
}

// 生成ARIMA预测
function generateARIMAPredictions(data: number[], arParams: number[], maParams: number[], periods: number, d: number): number[] {
    const predictions: number[] = [];
    const extendedData = [...data];
    
    for (let t = 0; t < periods; t++) {
        let prediction = 0;
        
        // AR部分
        for (let i = 0; i < arParams.length; i++) {
            if (extendedData.length > i) {
                prediction += arParams[i] * extendedData[extendedData.length - 1 - i];
            }
        }
        
        // MA部分 (简化)
        const maComponent = maParams.reduce((sum, coeff, i) => {
            return sum + coeff * (Math.random() - 0.5) * 0.1;
        }, 0);
        
        prediction += maComponent;
        
        // 添加趋势和季节性
        const trend = (data[data.length - 1] - data[Math.max(0, data.length - 4)]) / 4;
        const seasonal = Math.sin(2 * Math.PI * t / 12) * data[data.length - 1] * 0.05;
        
        prediction += trend * (t + 1) + seasonal;
        
        // 确保预测值为正
        prediction = Math.max(0, prediction);
        
        predictions.push(prediction);
        extendedData.push(prediction);
    }
    
    return predictions;
}

// 应用外部因素调整
function applyExternalFactors(predictions: number[], factors: any): number[] {
    const { exchangeRateChange, interestRateChange, customParams } = factors;
    
    return predictions.map((pred, index) => {
        let adjustment = 1;
        
        // 汇率影响
        adjustment *= (1 + exchangeRateChange * 0.3 * (index + 1) / predictions.length);
        
        // 利率影响
        adjustment *= (1 - interestRateChange * 0.5 * (index + 1) / predictions.length);
        
        // 自定义参数影响
        for (const [key, value] of Object.entries(customParams)) {
            if (typeof value === 'number') {
                adjustment *= (1 + value * 0.1 * (index + 1) / predictions.length);
            }
        }
        
        return pred * adjustment;
    });
}

// 计算残差
function calculateResiduals(data: number[], arParams: number[], maParams: number[]): number[] {
    const residuals: number[] = [];
    
    for (let i = Math.max(arParams.length, maParams.length); i < data.length; i++) {
        let fitted = 0;
        
        // AR部分
        for (let j = 0; j < arParams.length; j++) {
            fitted += arParams[j] * data[i - 1 - j];
        }
        
        residuals.push(data[i] - fitted);
    }
    
    return residuals;
}

// 计算置信区间
function calculateConfidenceIntervals(predictions: number[], sigma: number) {
    const z95 = 1.96;
    const z99 = 2.576;
    
    return {
        lower95: predictions.map((pred, i) => Math.max(0, pred - z95 * sigma * Math.sqrt(i + 1))),
        upper95: predictions.map((pred, i) => pred + z95 * sigma * Math.sqrt(i + 1)),
        lower99: predictions.map((pred, i) => Math.max(0, pred - z99 * sigma * Math.sqrt(i + 1))),
        upper99: predictions.map((pred, i) => pred + z99 * sigma * Math.sqrt(i + 1))
    };
}

// 模型诊断
function performModelDiagnostics(residuals: number[], autoCorr: number[], partialAutoCorr: number[]) {
    const ljungBox = calculateLjungBoxTest(residuals);
    const normalityTest = calculateNormalityTest(residuals);
    
    return {
        ljungBoxTest: {
            statistic: ljungBox.statistic,
            pValue: ljungBox.pValue,
            isWhiteNoise: ljungBox.pValue > 0.05
        },
        normalityTest: {
            statistic: normalityTest.statistic,
            pValue: normalityTest.pValue,
            isNormal: normalityTest.pValue > 0.05
        },
        residualStats: {
            mean: residuals.reduce((sum, val) => sum + val, 0) / residuals.length,
            variance: calculateVariance(residuals),
            skewness: calculateSkewness(residuals),
            kurtosis: calculateKurtosis(residuals)
        }
    };
}

// Ljung-Box测试
function calculateLjungBoxTest(residuals: number[]) {
    const n = residuals.length;
    const h = Math.min(10, Math.floor(n / 4));
    const autoCorr = calculateAutoCorrelation(residuals, h);
    
    let statistic = 0;
    for (let i = 0; i < h; i++) {
        statistic += Math.pow(autoCorr[i], 2) / (n - i - 1);
    }
    statistic *= n * (n + 2);
    
    // 简化的p值计算
    const pValue = 1 - Math.pow(Math.E, -statistic / 2);
    
    return { statistic, pValue };
}

// 正态性检验
function calculateNormalityTest(residuals: number[]) {
    const mean = residuals.reduce((sum, val) => sum + val, 0) / residuals.length;
    const variance = calculateVariance(residuals);
    const skewness = calculateSkewness(residuals);
    const kurtosis = calculateKurtosis(residuals);
    
    // Jarque-Bera检验
    const n = residuals.length;
    const statistic = n / 6 * (Math.pow(skewness, 2) + Math.pow(kurtosis - 3, 2) / 4);
    const pValue = 1 - Math.pow(Math.E, -statistic / 2);
    
    return { statistic, pValue };
}

// 计算标准差
function calculateStandardDeviation(data: number[]): number {
    const mean = data.reduce((sum, val) => sum + val, 0) / data.length;
    const variance = data.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / (data.length - 1);
    return Math.sqrt(variance);
}

// 计算方差
function calculateVariance(data: number[]): number {
    const mean = data.reduce((sum, val) => sum + val, 0) / data.length;
    return data.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / (data.length - 1);
}

// 计算偏度
function calculateSkewness(data: number[]): number {
    const mean = data.reduce((sum, val) => sum + val, 0) / data.length;
    const variance = calculateVariance(data);
    const stdDev = Math.sqrt(variance);
    
    const skewness = data.reduce((sum, val) => {
        return sum + Math.pow((val - mean) / stdDev, 3);
    }, 0) / data.length;
    
    return skewness;
}

// 计算峰度
function calculateKurtosis(data: number[]): number {
    const mean = data.reduce((sum, val) => sum + val, 0) / data.length;
    const variance = calculateVariance(data);
    const stdDev = Math.sqrt(variance);
    
    const kurtosis = data.reduce((sum, val) => {
        return sum + Math.pow((val - mean) / stdDev, 4);
    }, 0) / data.length;
    
    return kurtosis;
}

// 计算统计指标
function calculateStatistics(predictions: number[]) {
    const mean = predictions.reduce((sum, val) => sum + val, 0) / predictions.length;
    const variance = calculateVariance(predictions);
    const sorted = [...predictions].sort((a, b) => a - b);
    
    return {
        mean,
        median: sorted[Math.floor(sorted.length / 2)],
        standardDeviation: Math.sqrt(variance),
        variance,
        min: Math.min(...predictions),
        max: Math.max(...predictions),
        percentiles: {
            p5: sorted[Math.floor(sorted.length * 0.05)],
            p25: sorted[Math.floor(sorted.length * 0.25)],
            p75: sorted[Math.floor(sorted.length * 0.75)],
            p95: sorted[Math.floor(sorted.length * 0.95)]
        },
        range: Math.max(...predictions) - Math.min(...predictions),
        coefficientOfVariation: Math.sqrt(variance) / mean
    };
}

// 计算AIC
function calculateAIC(data: number[], arParams: number[], maParams: number[], residuals: number[]): number {
    const k = arParams.length + maParams.length + 1; // +1 for variance
    const n = residuals.length;
    const sse = residuals.reduce((sum, res) => sum + res * res, 0);
    const logLikelihood = -n / 2 * Math.log(2 * Math.PI * sse / n) - sse / 2;
    return 2 * k - 2 * logLikelihood;
}

// 计算BIC
function calculateBIC(data: number[], arParams: number[], maParams: number[], residuals: number[]): number {
    const k = arParams.length + maParams.length + 1;
    const n = residuals.length;
    const sse = residuals.reduce((sum, res) => sum + res * res, 0);
    const logLikelihood = -n / 2 * Math.log(2 * Math.PI * sse / n) - sse / 2;
    return Math.log(n) * k - 2 * logLikelihood;
}

// 计算R平方
function calculateRSquared(data: number[], residuals: number[]): number {
    const mean = data.reduce((sum, val) => sum + val, 0) / data.length;
    const tss = data.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0);
    const rss = residuals.reduce((sum, res) => sum + res * res, 0);
    return 1 - rss / tss;
}