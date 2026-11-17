// Discord IDs ("snowflakes") are numbers written as text, 17 to 20 digits long.
const SNOWFLAKE = /^\d{17,20}$/;

function isSnowflake(value) {
    return typeof value === 'string' && SNOWFLAKE.test(value);
}

module.exports = { isSnowflake };
