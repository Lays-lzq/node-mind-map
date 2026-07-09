export function success(res, data, msg = 'success') {
    res.json({ code: 0, data, msg });
}

export function fail(res, code, msg, httpStatus = 200) {
    res.status(httpStatus).json({ code, data: null, msg });
}
