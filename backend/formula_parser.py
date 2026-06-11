import re
from typing import List, Dict, Tuple, Optional

# Token definitions
TOKEN_SPEC = [
    ('NUMBER',     r'\d+(?:\.\d+)?'),
    ('COMPARE',    r'>=|<=|==|!=|>|<'),
    ('MATH',       r'[\+\-\*\/]'),
    ('LPAREN',     r'\('),
    ('RPAREN',     r'\)'),
    ('COMMA',      r','),
    ('IDENTIFIER', r'[a-zA-Z_][a-zA-Z0-9_]*'),
    ('SKIP',       r'\s+'),
    ('MISMATCH',   r'.'),
]

def tokenize_formula(text: str) -> List[Tuple[str, str]]:
    tokens = []
    regex = '|'.join(f'(?P<{name}>{pattern})' for name, pattern in TOKEN_SPEC)
    for mo in re.finditer(regex, text):
        kind = mo.lastgroup
        value = mo.group(kind)
        if kind == 'SKIP':
            continue
        elif kind == 'MISMATCH':
            raise SyntaxError(f"Unexpected character: {value!r}")
        tokens.append((kind, value))
    return tokens

# Date alignment helper across timeframes
def align_index_to_timeframe(timeseries_by_tf: Dict[str, List[dict]], current_idx: int, current_tf: str, target_tf: str) -> int:
    if current_tf == target_tf:
        return current_idx
        
    current_ts = timeseries_by_tf.get(current_tf)
    target_ts = timeseries_by_tf.get(target_tf)
    if not current_ts or not target_ts:
        return -1
        
    # Get absolute current index
    if current_idx < 0:
        abs_idx = len(current_ts) + current_idx
    else:
        abs_idx = current_idx
        
    if abs_idx < 0 or abs_idx >= len(current_ts):
        return -1
        
    target_date = current_ts[abs_idx]["date"]
    
    best_idx = 0
    for i, row in enumerate(target_ts):
        if row["date"] <= target_date:
            best_idx = i
        else:
            break
            
    # Return index relative to the end of target_ts
    return best_idx - len(target_ts)

# AST Base Node
class ASTNode:
    def evaluate(self, timeseries_by_tf: Dict[str, List[dict]], idx: int, current_tf: str) -> float:
        raise NotImplementedError()
        
    def get_required_timeframes(self) -> set:
        return set()

class ConstantNode(ASTNode):
    def __init__(self, value: float):
        self.value = value
        
    def evaluate(self, timeseries_by_tf: Dict[str, List[dict]], idx: int, current_tf: str) -> float:
        return self.value

class IndicatorNode(ASTNode):
    def __init__(self, name: str, timeframe: Optional[str] = None):
        self.name = name.upper().strip()
        self.timeframe = timeframe
        
    def evaluate(self, timeseries_by_tf: Dict[str, List[dict]], idx: int, current_tf: str) -> float:
        tf = self.timeframe or current_tf
        ts = timeseries_by_tf.get(tf)
        if not ts:
            return 0.0
            
        aligned_idx = align_index_to_timeframe(timeseries_by_tf, idx, current_tf, tf)
        if aligned_idx < -len(ts) or aligned_idx >= 0:
            # Out of bounds or invalid alignment, resolve negative index bounds
            abs_idx = len(ts) + aligned_idx
            if abs_idx < 0 or abs_idx >= len(ts):
                return 0.0
            aligned_idx = abs_idx
        else:
            aligned_idx = len(ts) + aligned_idx
            
        row = ts[aligned_idx]
        
        # Indicator mapping
        if self.name in ["CLOSE", "CL", "C"]:
            return float(row.get("Close", 0.0))
        elif self.name in ["HIGH", "HI", "H"]:
            return float(row.get("High", 0.0))
        elif self.name in ["LOW", "LO", "L"]:
            return float(row.get("Low", 0.0))
        elif self.name in ["OPEN", "OP", "O"]:
            return float(row.get("Open", 0.0))
        elif self.name in ["VOLUME", "VOL", "V"]:
            return float(row.get("Volume", 0.0))
        elif self.name == "RSI":
            return float(row.get("RSI_14", 50.0))
        elif self.name == "MACD":
            return float(row.get("MACD", 0.0))
        elif self.name in ["MACD_SIGNAL", "SIGNAL"]:
            return float(row.get("MACD_Signal", 0.0))
        elif self.name in ["BB_UPPER", "UPPER"]:
            return float(row.get("BB_Upper", 0.0))
        elif self.name in ["BB_LOWER", "LOWER"]:
            return float(row.get("BB_Lower", 0.0))
        elif self.name in ["SMA_50", "SMA50"]:
            return float(row.get("SMA_50", 0.0))
        elif self.name in ["SMA_200", "SMA200"]:
            return float(row.get("SMA_200", 0.0))
        elif self.name in ["EMA_50", "EMA50"]:
            return float(row.get("EMA_50", 0.0))
        elif self.name in ["EMA_200", "EMA200"]:
            return float(row.get("EMA_200", 0.0))
        elif self.name in ["VOL_RATIO", "VOL_BREAKOUT"]:
            return float(row.get("Vol_Ratio", 0.0))
        elif self.name in ["YEAR_HIGH", "52W_HIGH"]:
            return float(row.get("year_high", 0.0))
        elif self.name in ["YEAR_LOW", "52W_LOW"]:
            return float(row.get("year_low", 0.0))
            
        return 0.0
        
    def get_required_timeframes(self) -> set:
        if self.timeframe:
            return {self.timeframe}
        return set()

class BinaryOpNode(ASTNode):
    def __init__(self, left: ASTNode, op: str, right: ASTNode):
        self.left = left
        self.op = op
        self.right = right
        
    def evaluate(self, timeseries_by_tf: Dict[str, List[dict]], idx: int, current_tf: str) -> float:
        l_val = self.left.evaluate(timeseries_by_tf, idx, current_tf)
        r_val = self.right.evaluate(timeseries_by_tf, idx, current_tf)
        if self.op == '+':
            return l_val + r_val
        elif self.op == '-':
            return l_val - r_val
        elif self.op == '*':
            return l_val * r_val
        elif self.op == '/':
            return l_val / (r_val + 1e-9)
        return 0.0
        
    def get_required_timeframes(self) -> set:
        return self.left.get_required_timeframes() | self.right.get_required_timeframes()

class OffsetNode(ASTNode):
    def __init__(self, expr: ASTNode, offset: int):
        self.expr = expr
        self.offset = offset
        
    def evaluate(self, timeseries_by_tf: Dict[str, List[dict]], idx: int, current_tf: str) -> float:
        # Evaluate inner node shifted backwards by the offset
        return self.expr.evaluate(timeseries_by_tf, idx - self.offset, current_tf)
        
    def get_required_timeframes(self) -> set:
        return self.expr.get_required_timeframes()

class FunctionNode(ASTNode):
    def __init__(self, name: str, args: List[ASTNode], timeframe: Optional[str] = None):
        self.name = name.upper().strip()
        self.args = args
        self.timeframe = timeframe
        
    def get_required_timeframes(self) -> set:
        tfs = set()
        if self.timeframe:
            tfs.add(self.timeframe)
        for arg in self.args:
            tfs |= arg.get_required_timeframes()
        return tfs
        
    def evaluate(self, timeseries_by_tf: Dict[str, List[dict]], idx: int, current_tf: str) -> float:
        tf = self.timeframe or current_tf
        ts = timeseries_by_tf.get(tf)
        if not ts:
            return 0.0
            
        aligned_idx = align_index_to_timeframe(timeseries_by_tf, idx, current_tf, tf)
        if aligned_idx < -len(ts) or aligned_idx >= 0:
            abs_idx = len(ts) + aligned_idx
            if abs_idx < 0 or abs_idx >= len(ts):
                return 0.0
            aligned_idx = abs_idx
        else:
            aligned_idx = len(ts) + aligned_idx
            
        # Parse arguments (period vs sub-expression)
        period = 14
        expr = None
        
        if len(self.args) == 1:
            arg = self.args[0]
            if isinstance(arg, ConstantNode):
                period = int(arg.value)
                expr = IndicatorNode("Close")
            else:
                expr = arg
        elif len(self.args) >= 2:
            arg1, arg2 = self.args[0], self.args[1]
            if isinstance(arg1, ConstantNode) and not isinstance(arg2, ConstantNode):
                period = int(arg1.value)
                expr = arg2
            elif isinstance(arg2, ConstantNode) and not isinstance(arg1, ConstantNode):
                period = int(arg2.value)
                expr = arg1
            elif isinstance(arg1, ConstantNode) and isinstance(arg2, ConstantNode):
                period = int(arg1.value)
                expr = arg2
            else:
                period = 14
                expr = arg1
        else:
            return 0.0
            
        period = max(1, period)
        
        if self.name in ["MAX", "MIN", "SMA"]:
            start_idx = max(0, aligned_idx - period + 1)
            vals = []
            for k in range(start_idx, aligned_idx + 1):
                # evaluate subexpression relative to absolute list index
                # aligned evaluate requires index relative to ts length
                vals.append(expr.evaluate(timeseries_by_tf, k - len(ts), tf))
                
            if not vals:
                return 0.0
                
            if self.name == "MAX":
                return max(vals)
            elif self.name == "MIN":
                return min(vals)
            elif self.name == "SMA":
                return sum(vals) / len(vals)
                
        elif self.name == "EMA":
            # EMA requires calculation from start of series up to aligned_idx
            vals = [expr.evaluate(timeseries_by_tf, k - len(ts), tf) for k in range(aligned_idx + 1)]
            if not vals:
                return 0.0
            
            alpha = 2.0 / (period + 1.0)
            ema = vals[0]
            for val in vals[1:]:
                ema = val * alpha + ema * (1 - alpha)
            return ema
            
        return 0.0

# Recursive Descent Parser
class Parser:
    def __init__(self, tokens: List[Tuple[str, str]]):
        self.tokens = tokens
        self.pos = 0
        
    def current_token(self) -> Optional[Tuple[str, str]]:
        if self.pos < len(self.tokens):
            return self.tokens[self.pos]
        return None
        
    def match(self, token_type: str) -> Optional[Tuple[str, str]]:
        tok = self.current_token()
        if tok and tok[0] == token_type:
            self.pos += 1
            return tok
        return None
        
    def expect(self, token_type: str) -> Tuple[str, str]:
        tok = self.match(token_type)
        if not tok:
            curr = self.current_token()
            raise SyntaxError(f"Expected token {token_type}, got {curr}")
        return tok
        
    def parse_condition(self) -> Tuple[ASTNode, str, ASTNode]:
        left = self.parse_expr()
        op_tok = self.match('COMPARE')
        if not op_tok:
            raise SyntaxError("Expected comparison operator (>=, <=, >, <, ==, !=)")
        right = self.parse_expr()
        return (left, op_tok[1], right)
        
    def parse_expr(self) -> ASTNode:
        node = self.parse_term()
        while True:
            op_tok = self.match('MATH')
            if op_tok and op_tok[1] in ('+', '-'):
                right = self.parse_term()
                node = BinaryOpNode(node, op_tok[1], right)
            else:
                break
        return node
        
    def parse_term(self) -> ASTNode:
        node = self.parse_factor()
        while True:
            op_tok = self.match('MATH')
            if op_tok and op_tok[1] in ('*', '/'):
                right = self.parse_factor()
                node = BinaryOpNode(node, op_tok[1], right)
            else:
                break
        return node
        
    def parse_factor(self) -> ASTNode:
        # Check for lookback prefix: e.g. "30 days ago Max(8, High)"
        curr_tok = self.current_token()
        if curr_tok and curr_tok[0] == 'NUMBER' and (self.pos + 2 < len(self.tokens)):
            next1 = self.tokens[self.pos + 1]
            next2 = self.tokens[self.pos + 2]
            if (next1[0] == 'IDENTIFIER' and 
                next1[1].lower() in ('day', 'days', 'week', 'weeks', 'month', 'months', 'candle', 'candles', 'bar', 'bars') and 
                next2[0] == 'IDENTIFIER' and 
                next2[1].lower() == 'ago'):
                
                offset_val = int(float(curr_tok[1]))
                self.pos += 3  # consume NUMBER, time unit, and "ago"
                inner = self.parse_factor()
                return OffsetNode(inner, offset_val)
                
        return self.parse_primary()
        
    def parse_primary(self) -> ASTNode:
        tok = self.current_token()
        if not tok:
            raise SyntaxError("Unexpected end of expression")
            
        if self.match('LPAREN'):
            node = self.parse_expr()
            self.expect('RPAREN')
            return node
            
        if self.match('NUMBER'):
            return ConstantNode(float(tok[1]))
            
        if tok[0] == 'IDENTIFIER':
            name = tok[1]
            self.pos += 1
            
            # Check for timeframe prefix
            if name.lower() in ('daily', 'weekly', 'monthly'):
                tf_map = {'daily': '1d', 'weekly': '1wk', 'monthly': '1mo'}
                tf = tf_map[name.lower()]
                
                next_tok = self.current_token()
                if not next_tok or next_tok[0] != 'IDENTIFIER':
                    raise SyntaxError(f"Expected indicator or function name after timeframe '{name}'")
                    
                name = next_tok[1]
                self.pos += 1
                
                if self.current_token() and self.current_token()[0] == 'LPAREN':
                    self.pos += 1  # consume '('
                    args = self.parse_arg_list()
                    self.expect('RPAREN')
                    return FunctionNode(name, args, timeframe=tf)
                else:
                    return IndicatorNode(name, timeframe=tf)
                    
            # Check for standard function call
            if self.current_token() and self.current_token()[0] == 'LPAREN':
                self.pos += 1  # consume '('
                args = self.parse_arg_list()
                self.expect('RPAREN')
                return FunctionNode(name, args)
            else:
                return IndicatorNode(name)
                
        raise SyntaxError(f"Unexpected token: {tok}")
        
    def parse_arg_list(self) -> List[ASTNode]:
        args = []
        if self.current_token() and self.current_token()[0] != 'RPAREN':
            args.append(self.parse_expr())
            while self.match('COMMA'):
                args.append(self.parse_expr())
        return args

def parse_formula_to_conditions(text: str) -> List[Tuple[ASTNode, str, ASTNode]]:
    conditions = []
    lines = text.strip().split('\n')
    for i, line in enumerate(lines):
        line = line.strip()
        if not line or line.startswith('#') or line.startswith('//'):
            continue
        try:
            tokens = tokenize_formula(line)
            parser = Parser(tokens)
            cond = parser.parse_condition()
            if parser.pos < len(tokens):
                trailing = tokens[parser.pos:]
                raise SyntaxError(f"Trailing unparsed tokens: {trailing}")
            conditions.append(cond)
        except Exception as e:
            raise ValueError(f"Error parsing line {i+1} ('{line}'): {str(e)}")
    return conditions

def evaluate_ast_condition(left: ASTNode, op: str, right: ASTNode, timeseries_by_tf: Dict[str, List[dict]], idx: int, default_timeframe: str = "1d") -> bool:
    left_val = left.evaluate(timeseries_by_tf, idx, default_timeframe)
    right_val = right.evaluate(timeseries_by_tf, idx, default_timeframe)
    
    if op == '>':
        return left_val > right_val
    elif op == '<':
        return left_val < right_val
    elif op == '>=':
        return left_val >= right_val
    elif op == '<=':
        return left_val <= right_val
    elif op == '==':
        return abs(left_val - right_val) < 1e-5
    elif op == '!=':
        return abs(left_val - right_val) >= 1e-5
    return False
